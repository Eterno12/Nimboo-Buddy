import path from 'node:path';
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Notification, screen, session, type Tray } from 'electron';
import { IPC, type PanelView, type SettingsSnapshot } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import { createPanelWindow } from './windows';
import { createTray } from './tray';
import { createSettingsStore, type SettingsStore } from './settingsStore';
import { createWindowModeManager, type WindowModeManager } from './windowMode';
import { startTasksService, type TasksService } from './tasksService';
import { startFocusService, type FocusService } from './focusService';
import { startSettingsService, type SettingsService } from './settingsService';
import { startFullscreenWatcher, type FullscreenWatcher } from './dnd';
import { ReminderScheduler, type Reminder } from './reminders';
import { FocusLog } from './focus/focusLog';
import type { FocusConfig } from '../shared/focus';

let mascot: BrowserWindow | null = null;
let windowMode: WindowModeManager | null = null;
let tasks: TasksService | null = null;
let focus: FocusService | null = null;
let settingsStore: SettingsStore | null = null;
let settingsService: SettingsService | null = null;
let reminders: ReminderScheduler | null = null;
let focusLog: FocusLog | null = null;
let panel: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
/** Tela do painel pedida por quem o abriu; entregue uma vez quando o painel (novo) a pede. */
let pendingPanelView: PanelView = 'home';
/** O atalho global escolhido está registrado (outro app pode já tê-lo). */
let shortcutActive = false;
let fullscreenWatcher: FullscreenWatcher | null = null;
/** O Mochi foi escondido por causa de um app em tela cheia (e não pela pessoa). */
let hiddenByFullscreen = false;

const isAppUrl = (url: string): boolean =>
  process.env.VITE_DEV_SERVER_URL ? url.startsWith(process.env.VITE_DEV_SERVER_URL) : url.startsWith('file://');

function showPanel(view: PanelView = 'home'): void {
  if (!panel || panel.isDestroyed()) {
    pendingPanelView = view;
    panel = createPanelWindow();
    // Fechar o painel apenas o oculta, exceto ao sair do app.
    panel.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        panel?.hide();
      }
    });
    panel.once('ready-to-show', () => panel?.show());
    return;
  }
  panel.webContents.send(IPC.panelNavigate, view);
  panel.show();
  panel.focus();
}

function toggleMascot(): void {
  if (!mascot || mascot.isDestroyed()) return;
  hiddenByFullscreen = false; // a escolha da pessoa vale mais que a automática
  if (mascot.isVisible()) mascot.hide();
  else mascot.show();
}

/** O que o renderer precisa saber além das preferências. */
function settingsSnapshot(): SettingsSnapshot {
  return {
    settings: (settingsStore as SettingsStore).get(),
    packaged: app.isPackaged,
    shortcutActive,
    effective: windowMode?.getScales() ?? { islandScale: 1, mochiScale: 1 },
  };
}

/** Atalho global: na ilha, abre direto nas tarefas; no modo flutuante, abre o painel. */
function onGlobalShortcut(): void {
  hiddenByFullscreen = false;
  if (windowMode?.getMode() === 'floating') {
    showPanel();
    return;
  }
  void windowMode?.summon();
}

/** (Re)registra o atalho global. `null` desliga. Falha (atalho em uso por outro app) não é erro fatal. */
function applyShortcut(accelerator: string | null): void {
  globalShortcut.unregisterAll();
  shortcutActive = false;
  if (!accelerator) return;
  try {
    globalShortcut.register(accelerator, onGlobalShortcut);
    // Confere pelo estado real: o retorno de `register` nem sempre reflete o registro no Windows.
    shortcutActive = globalShortcut.isRegistered(accelerator);
  } catch (error) {
    console.error('Não foi possível registrar o atalho global:', error);
  }
}

/** Só no app instalado: em desenvolvimento registraria o executável do Electron, não o Mochi. */
function applyLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (error) {
    console.error('Não foi possível ajustar "iniciar com o Windows":', error);
  }
}

/** Esconde o Mochi enquanto há um app em tela cheia e o traz de volta depois. */
function applyDoNotDisturb(enabled: boolean): void {
  if (!enabled) {
    fullscreenWatcher?.stop();
    fullscreenWatcher = null;
    if (hiddenByFullscreen && mascot && !mascot.isDestroyed()) mascot.show();
    hiddenByFullscreen = false;
    return;
  }
  if (fullscreenWatcher) return;
  fullscreenWatcher = startFullscreenWatcher({
    onChange: (fullscreen) => {
      if (!mascot || mascot.isDestroyed()) return;
      if (fullscreen) {
        if (mascot.isVisible()) {
          hiddenByFullscreen = true;
          mascot.hide();
        }
      } else if (hiddenByFullscreen) {
        hiddenByFullscreen = false;
        mascot.show();
      }
    },
  });
}

const focusConfigOf = (s: Settings): FocusConfig => ({
  focusMinutes: s.focusMinutes,
  breakMinutes: s.breakMinutes,
  longBreakMinutes: s.longBreakMinutes,
  cycle: s.pomodoroCycle,
  autoAdvance: s.pomodoroAuto,
});

/** Lembrete de prazo: o renderer mostra o balão e toca o som; sem mascote visível, vira notificação. */
function deliverReminder(reminder: Reminder): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IPC.tasksReminder, reminder);
    } catch (error) {
      console.error('Falha ao entregar o lembrete a uma janela:', error);
    }
  }
  const visible = !!mascot && !mascot.isDestroyed() && mascot.isVisible();
  if (!visible && Notification.isSupported()) {
    const title = reminder.title.length > 80 ? `${reminder.title.slice(0, 77)}...` : reminder.title;
    new Notification({
      title: reminder.kind === 'due' ? 'Chegou a hora' : `Em ${reminder.minutes} minutos`,
      body: title,
      silent: true,
    }).show();
  }
}

/** Efeitos de uma mudança de preferências que vão além de redesenhar as janelas. */
function applySettingsChange(previous: Settings, next: Settings): void {
  if (previous.islandScale !== next.islandScale || previous.mochiScale !== next.mochiScale) {
    windowMode?.refreshLayout();
  }
  if (previous.shortcut !== next.shortcut) applyShortcut(next.shortcut);
  if (previous.launchAtLogin !== next.launchAtLogin) applyLaunchAtLogin(next.launchAtLogin);
  if (previous.doNotDisturb !== next.doNotDisturb) applyDoNotDisturb(next.doNotDisturb);
  focus?.configure(focusConfigOf(next));
  reminders?.setConfig({ enabled: next.remindersEnabled, leadMinutes: next.reminderLeadMin });
}

function buildMenu(): Menu {
  const mascotVisible = !!mascot && !mascot.isDestroyed() && mascot.isVisible();
  const mode = windowMode?.getMode();
  const away = windowMode?.isAway() ?? false;
  const inIsland = windowMode?.getPresentation() === 'island';

  // Itens que dependem do modo preferido e de a ilha estar à vista ou escondida.
  const modeItems: Electron.MenuItemConstructorOptions[] = [];
  if (mode === 'island') {
    if (inIsland) {
      modeItems.push({
        label: windowMode?.isIslandOpen() ? 'Recolher ilha' : 'Expandir ilha',
        click: () => windowMode?.requestIslandToggle(),
      });
    } else if (away) {
      modeItems.push({ label: 'Mostrar ilha', click: () => void windowMode?.showIsland() });
    }
    modeItems.push({ label: 'Usar modo flutuante', click: () => void windowMode?.setMode('floating') });
  } else {
    modeItems.push({ label: 'Usar modo ilha', click: () => void windowMode?.setMode('island') });
  }

  return Menu.buildFromTemplate([
    { label: 'Mostrar painel', click: () => showPanel() },
    { label: 'Configurações', click: () => showPanel('settings') },
    { label: mascotVisible ? 'Ocultar mascote' : 'Mostrar mascote', click: toggleMascot },
    ...modeItems,
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
}
/** Arraste da janela: o main lê o cursor, o renderer não envia coordenadas. */
function registerDragHandlers(): void {
  let drag: { cursorX: number; cursorY: number; winX: number; winY: number } | null = null;

  const fromMascot = (sender: Electron.WebContents) =>
    !!mascot && !mascot.isDestroyed() && mascot.webContents === sender;

  // Na ilha a janela fica ancorada no topo: o arraste só vale no modo flutuante.
  const canDrag = () => windowMode?.getPresentation() === 'floating';

  ipcMain.on(IPC.dragStart, (event) => {
    if (!canDrag() || !fromMascot(event.sender) || !mascot) return;
    const cursor = screen.getCursorScreenPoint();
    const [winX, winY] = mascot.getPosition();
    drag = { cursorX: cursor.x, cursorY: cursor.y, winX, winY };
  });

  ipcMain.on(IPC.dragMove, (event) => {
    if (!drag || !canDrag() || !fromMascot(event.sender) || !mascot) return;
    const cursor = screen.getCursorScreenPoint();
    const { width, height } = mascot.getBounds();
    // setBounds com tamanho fixo evita deriva de tamanho com escala de DPI fracionária.
    mascot.setBounds({
      x: drag.winX + cursor.x - drag.cursorX,
      y: drag.winY + cursor.y - drag.cursorY,
      width,
      height,
    });
  });

  ipcMain.on(IPC.dragEnd, () => {
    drag = null;
  });

  ipcMain.on(IPC.showMenu, (event) => {
    if (!fromMascot(event.sender) || !mascot) return;
    buildMenu().popup({ window: mascot });
  });
}

const CURSOR_POLL_MS = 40;
let cursorTimer: NodeJS.Timeout | null = null;

/** Envia ao mascote a posição do cursor (somente leitura), apenas quando muda. */
function startCursorBroadcast(): void {
  let last = '';
  cursorTimer = setInterval(() => {
    if (!mascot || mascot.isDestroyed() || !mascot.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    windowMode?.onCursor(cursor); // revelação da ilha pela borda superior
    const bounds = mascot.getBounds();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;
    const key = `${x},${y}`;
    if (key === last) return;
    last = key;
    mascot.webContents.send(IPC.cursor, { x, y });
  }, CURSOR_POLL_MS);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mascot && !mascot.isDestroyed() && !mascot.isVisible()) mascot.show();
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    registerDragHandlers();
    const settings = createSettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    settingsStore = settings;
    const startup = settings.get();
    reminders = new ReminderScheduler({
      config: { enabled: startup.remindersEnabled, leadMinutes: startup.reminderLeadMin },
      onReminder: deliverReminder,
    });
    // O banco fica em userData/data; só o processo principal o abre.
    tasks = startTasksService({
      dbPath: path.join(app.getPath('userData'), 'data', 'mochi.db'),
      isAppUrl,
      onTasksChanged: (list) => reminders?.sync(list),
    });
    const database = tasks.database();
    if (database) {
      focusLog = new FocusLog(database);
      try {
        focusLog.purge();
      } catch (error) {
        console.error('Falha ao limpar o registro de foco:', error);
      }
    }
    windowMode = createWindowModeManager(settings);
    mascot = windowMode.window;

    // Painel: tela inicial pedida por quem o abriu (menu da bandeja, engrenagem da ilha).
    const trustedSender = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return !!win && !win.isDestroyed() && event.senderFrame === event.sender.mainFrame && isAppUrl(event.senderFrame?.url ?? '');
    };
    ipcMain.handle(IPC.panelInitialView, (event): PanelView => {
      if (!trustedSender(event)) return 'home';
      const view = pendingPanelView;
      pendingPanelView = 'home';
      return view;
    });
    ipcMain.on(IPC.panelOpenSettings, (event) => {
      if (trustedSender(event)) showPanel('settings');
    });

    // Preferências: tamanhos, atalho global, iniciar com o Windows, não incomodar.
    settingsService = startSettingsService({
      store: settings,
      isAppUrl,
      snapshot: settingsSnapshot,
      onChanged: applySettingsChange,
    });
    const initial = settings.get();
    applyShortcut(initial.shortcut);
    applyLaunchAtLogin(initial.launchAtLogin);
    applyDoNotDisturb(initial.doNotDisturb);

    // O temporizador vive no main; ao terminar, a ilha volta (se estava escondida) ou
    // avisa por notificação quando o mascote está oculto.
    focus = startFocusService({
      isAppUrl,
      config: focusConfigOf(startup),
      getLog: () => focusLog,
      onFinished: (kind) => {
        const visible = !!mascot && !mascot.isDestroyed() && mascot.isVisible();
        if (!visible && Notification.isSupported()) {
          new Notification({
            title: 'Mochi',
            body: kind === 'focus' ? 'Sessão de foco concluída. Hora de uma pausa!' : 'Pausa concluída. Pronto para focar?',
            silent: true,
          }).show();
        } else if (windowMode?.isAway()) {
          void windowMode.showIsland();
        }
      },
    });
    tray = createTray(buildMenu, toggleMascot);
    startCursorBroadcast();
  });

  app.on('before-quit', () => {
    quitting = true;
    if (cursorTimer) clearInterval(cursorTimer);
    globalShortcut.unregisterAll();
    fullscreenWatcher?.stop();
    settingsService?.close();
    windowMode?.dispose();
    focus?.close();
    reminders?.dispose();
    tasks?.close();
    tray?.destroy();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
