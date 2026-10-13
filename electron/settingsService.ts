import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC, type SettingsSnapshot } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import type { SettingsStore } from './settingsStore';

/** Campos que as janelas do app podem alterar. `mode`, posição e monitor são do `windowMode`. */
const EDITABLE: readonly (keyof Settings)[] = [
  'islandScale',
  'mochiScale',
  'hideDelaySec',
  'launchAtLogin',
  'shortcut',
  'soundEnabled',
  'soundVolume',
  'bubbles',
  'doNotDisturb',
  'color',
  'focusMinutes',
  'breakMinutes',
  'longBreakMinutes',
  'pomodoroCycle',
  'pomodoroAuto',
  'remindersEnabled',
  'reminderLeadMin',
];

export interface SettingsService {
  /** Os valores de `snapshot()` mudaram por outro caminho (ex.: o atalho não pôde ser registrado). */
  broadcast(): void;
  close(): void;
}

interface SettingsServiceOptions {
  store: SettingsStore;
  /** URL de origem das páginas do app (servidor de desenvolvimento) ou `file://`. */
  isAppUrl(url: string): boolean;
  snapshot(): SettingsSnapshot;
  /** Aplica efeitos fora das janelas (tamanho, atalho, iniciar com o Windows, tela cheia). */
  onChanged(previous: Settings, next: Settings): void;
}

/**
 * Preferências por IPC. O renderer envia um patch parcial; só campos editáveis passam, e o valor
 * final é sempre o que `parseSettings` aceita (passos permitidos, atalhos predefinidos).
 */
export function startSettingsService(options: SettingsServiceOptions): SettingsService {
  const { store, isAppUrl } = options;

  const send = () => {
    const snapshot = options.snapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.settingsChanged, snapshot);
      } catch (error) {
        console.error('Falha ao avisar uma janela sobre as preferências:', error);
      }
    }
  };

  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };

  ipcMain.handle(IPC.settingsGet, (event) => {
    if (!trusted(event)) throw new Error('Remetente não autorizado');
    return options.snapshot();
  });

  ipcMain.handle(IPC.settingsUpdate, (event, patch: unknown) => {
    if (!trusted(event)) throw new Error('Remetente não autorizado');
    if (typeof patch === 'object' && patch !== null && !Array.isArray(patch)) {
      const filtered: Record<string, unknown> = {};
      for (const key of EDITABLE) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) filtered[key] = (patch as Record<string, unknown>)[key];
      }
      if (Object.keys(filtered).length > 0) {
        const previous = store.get();
        store.update(filtered as Partial<Omit<Settings, 'version'>>);
        const next = store.get();
        try {
          options.onChanged(previous, next);
        } catch (error) {
          console.error('Falha ao aplicar as preferências:', error);
        }
        send();
      }
    }
    return options.snapshot();
  });

  return {
    broadcast: send,
    close() {
      ipcMain.removeHandler(IPC.settingsGet);
      ipcMain.removeHandler(IPC.settingsUpdate);
    },
  };
}
