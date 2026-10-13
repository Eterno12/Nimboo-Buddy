import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, Notification, screen, session, type Tray } from 'electron';
import { IPC } from '../shared/ipc';
import { createPanelWindow } from './windows';
import { createTray } from './tray';
import { createSettingsStore } from './settingsStore';
import { createWindowModeManager, type WindowModeManager } from './windowMode';
import { startTasksService, type TasksService } from './tasksService';
import { startFocusService, type FocusService } from './focusService';

let mascot: BrowserWindow | null = null;
let windowMode: WindowModeManager | null = null;
let tasks: TasksService | null = null;
let focus: FocusService | null = null;
let panel: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function showPanel(): void {
  if (!panel || panel.isDestroyed()) {
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
  panel.show();
  panel.focus();
}

function toggleMascot(): void {
  if (!mascot || mascot.isDestroyed()) return;
  if (mascot.isVisible()) mascot.hide();
  else mascot.show();
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
    { label: 'Mostrar painel', click: showPanel },
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
    // O banco fica em userData/data; só o processo principal o abre.
    tasks = startTasksService({
      dbPath: path.join(app.getPath('userData'), 'data', 'mochi.db'),
      isAppUrl: (url) =>
        process.env.VITE_DEV_SERVER_URL ? url.startsWith(process.env.VITE_DEV_SERVER_URL) : url.startsWith('file://'),
    });
    windowMode = createWindowModeManager(settings);
    mascot = windowMode.window;
    // O temporizador vive no main; ao terminar, a ilha volta (se estava escondida) ou
    // avisa por notificação quando o mascote está oculto.
    focus = startFocusService({
      isAppUrl: (url) =>
        process.env.VITE_DEV_SERVER_URL ? url.startsWith(process.env.VITE_DEV_SERVER_URL) : url.startsWith('file://'),
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
    windowMode?.dispose();
    focus?.close();
    tasks?.close();
    tray?.destroy();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
