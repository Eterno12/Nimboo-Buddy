import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import { focusFail, type FocusKind, type FocusResult, type FocusState } from '../shared/focus';
import { FocusTimer } from './focus/focusTimer';

export interface FocusService {
  close(): void;
}

interface FocusServiceOptions {
  /** URL de origem das páginas do app (servidor de desenvolvimento) ou `file://`. */
  isAppUrl(url: string): boolean;
  /** Uma sessão terminou sozinha (o main decide como avisar: ilha, notificação). */
  onFinished(kind: FocusKind): void;
}

const CHANNELS = [IPC.focusGet, IPC.focusStart, IPC.focusPause, IPC.focusResume, IPC.focusCancel];

/**
 * Liga o temporizador ao IPC. O relógio vive só no processo principal; as janelas
 * pedem operações específicas e tipadas e são avisadas das mudanças de estado
 * (nunca a cada segundo: cada janela calcula o restante a partir de `endsAt`).
 */
export function startFocusService({ isAppUrl, onFinished }: FocusServiceOptions): FocusService {
  /** Cada envio é isolado: uma janela com problema não impede as demais. */
  const send = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(channel, payload);
      } catch (error) {
        console.error('Falha ao avisar uma janela sobre o modo foco:', error);
      }
    }
  };

  const timer = new FocusTimer({
    onChange: (state: FocusState) => send(IPC.focusChanged, state),
    onFinished: (kind) => {
      send(IPC.focusFinished, kind);
      try {
        onFinished(kind);
      } catch (error) {
        console.error('Falha ao avisar o fim da sessão de foco:', error);
      }
    },
  });

  /** Só o quadro principal de uma janela do próprio app pode controlar o temporizador. */
  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };

  const UNAUTHORIZED = (): FocusResult<never> => focusFail('unavailable', 'Remetente não autorizado.');

  ipcMain.handle(IPC.focusGet, (event): FocusState | null => (trusted(event) ? timer.getState() : null));
  ipcMain.handle(IPC.focusStart, (event, kind: unknown, minutes: unknown) =>
    trusted(event) ? timer.start(kind, minutes) : UNAUTHORIZED(),
  );
  ipcMain.handle(IPC.focusPause, (event) => (trusted(event) ? timer.pause() : UNAUTHORIZED()));
  ipcMain.handle(IPC.focusResume, (event) => (trusted(event) ? timer.resume() : UNAUTHORIZED()));
  ipcMain.handle(IPC.focusCancel, (event) => (trusted(event) ? timer.cancel() : UNAUTHORIZED()));

  return {
    close() {
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      timer.dispose();
    },
  };
}
