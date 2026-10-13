import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import {
  DEFAULT_FOCUS_CONFIG,
  focusFail,
  type FocusConfig,
  type FocusKind,
  type FocusResult,
  type FocusState,
  type FocusStats,
} from '../shared/focus';
import { FocusTimer, type FinishedSession } from './focus/focusTimer';
import type { FocusLog } from './focus/focusLog';

export interface FocusService {
  /** Preferências mudaram (durações, ciclo Pomodoro). */
  configure(config: FocusConfig): void;
  close(): void;
}

interface FocusServiceOptions {
  /** URL de origem das páginas do app (servidor de desenvolvimento) ou `file://`. */
  isAppUrl(url: string): boolean;
  /** Uma sessão terminou sozinha (o main decide como avisar: ilha, notificação). */
  onFinished(kind: FocusKind): void;
  /** Registro das sessões concluídas (pode não existir se o banco não abriu). */
  getLog(): FocusLog | null;
  config?: FocusConfig;
}

const CHANNELS = [
  IPC.focusGet,
  IPC.focusStart,
  IPC.focusPause,
  IPC.focusResume,
  IPC.focusCancel,
  IPC.focusStats,
];

/** Com o ciclo Pomodoro em modo automático, quanto tempo a mensagem de "concluído" fica antes de seguir. */
export const AUTO_ADVANCE_MS = 5000;

/**
 * Liga o temporizador ao IPC. O relógio vive só no processo principal; as janelas
 * pedem operações específicas e tipadas e são avisadas das mudanças de estado
 * (nunca a cada segundo: cada janela calcula o restante a partir de `endsAt`).
 */
export function startFocusService({ isAppUrl, onFinished, getLog, config }: FocusServiceOptions): FocusService {
  let autoTimer: ReturnType<typeof setTimeout> | undefined;
  let current: FocusConfig = { ...(config ?? DEFAULT_FOCUS_CONFIG) };

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

  /** Registra a sessão concluída (uma falha de gravação nunca atrapalha o aviso ao usuário). */
  const record = (session: FinishedSession) => {
    try {
      getLog()?.record({
        kind: session.kind,
        minutes: session.minutes,
        taskId: session.task?.id ?? null,
        at: new Date(session.at),
      });
    } catch (error) {
      console.error('Falha ao registrar a sessão de foco:', error);
    }
  };

  const timer: FocusTimer = new FocusTimer({
    config: current,
    onChange: (state: FocusState) => {
      if (state.status !== 'finished') clearTimeout(autoTimer); // a pessoa agiu: nada de avanço automático
      send(IPC.focusChanged, state);
    },
    onFinished: (kind, session) => {
      record(session);
      send(IPC.focusFinished, kind);
      try {
        onFinished(kind);
      } catch (error) {
        console.error('Falha ao avisar o fim da sessão de foco:', error);
      }
      // Ciclo automático: depois de uns segundos (a mensagem fica à vista), segue para a próxima etapa.
      if (current.cycle && current.autoAdvance) {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => {
          const s = timer.getState();
          if (s.status === 'finished' && s.next) timer.start(s.next.kind, s.next.minutes);
        }, AUTO_ADVANCE_MS);
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
  ipcMain.handle(IPC.focusStart, (event, kind: unknown, minutes: unknown, task: unknown) =>
    trusted(event) ? timer.start(kind, minutes, task) : UNAUTHORIZED(),
  );
  ipcMain.handle(IPC.focusPause, (event) => (trusted(event) ? timer.pause() : UNAUTHORIZED()));
  ipcMain.handle(IPC.focusResume, (event) => (trusted(event) ? timer.resume() : UNAUTHORIZED()));
  ipcMain.handle(IPC.focusCancel, (event) => (trusted(event) ? timer.cancel() : UNAUTHORIZED()));
  ipcMain.handle(IPC.focusStats, (event): FocusStats => {
    const empty: FocusStats = { sessions: 0, minutes: 0 };
    if (!trusted(event)) return empty;
    try {
      return getLog()?.today() ?? empty;
    } catch (error) {
      console.error('Falha ao ler a estatística do foco:', error);
      return empty;
    }
  });

  return {
    configure(next) {
      current = { ...next };
      timer.configure(next);
      if (!(current.cycle && current.autoAdvance)) clearTimeout(autoTimer);
    },
    close() {
      clearTimeout(autoTimer);
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      timer.dispose();
    },
  };
}
