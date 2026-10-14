import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import {
  REMINDER_ACTIONS,
  REMINDER_SNOOZE_MS,
  REMINDER_TOAST_MS,
  type ReminderToastAction,
  type ReminderToastInfo,
} from '../shared/reminderToast';
import type { Reminder } from './reminders';
import { createReminderToastWindow } from './windows';

export type ReminderSource = 'task' | 'event';

interface Options {
  isAppUrl(url: string): boolean;
  /** Mostrar agora? (falso com app em tela cheia). */
  canShow(): boolean;
  completeTask(id: string): Promise<boolean>;
}

export interface ReminderToasts {
  show(reminder: Reminder, source: ReminderSource, snoozed?: boolean): void;
  close(): void;
}

/** Avisos de lembrete com Concluir / Adiar / Dispensar (janela própria, sem roubar o foco). */
export function startReminderToasts({ isAppUrl, canShow, completeTask }: Options): ReminderToasts {
  interface Live {
    reminder: Reminder;
    source: ReminderSource;
    snoozed: boolean;
    win: BrowserWindow;
    timer: NodeJS.Timeout;
  }
  const live = new Map<string, Live>();
  const snoozeTimers = new Set<NodeJS.Timeout>();
  let counter = 0;
  let disposed = false;

  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || w.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };

  const dismiss = (token: string) => {
    const item = live.get(token);
    if (!item) return;
    live.delete(token);
    clearTimeout(item.timer);
    if (!item.win.isDestroyed()) item.win.destroy();
  };

  const show = (reminder: Reminder, source: ReminderSource, snoozed = false) => {
    if (disposed || !canShow()) return;
    // O mesmo item ainda na tela (ex.: "Adiar" voltando): troca pelo novo.
    for (const [token, item] of live) {
      if (item.reminder.taskId === reminder.taskId) dismiss(token);
    }
    const token = `r${++counter}`;
    const win = createReminderToastWindow(token, screen.getPrimaryDisplay().workArea);
    const timer = setTimeout(() => dismiss(token), REMINDER_TOAST_MS);
    live.set(token, { reminder, source, snoozed, win, timer });
    win.once('closed', () => {
      const item = live.get(token);
      if (item) {
        clearTimeout(item.timer);
        live.delete(token);
      }
    });
  };

  ipcMain.handle(IPC.reminderGet, (event, token: unknown): ReminderToastInfo | null => {
    if (!trusted(event) || typeof token !== 'string') return null;
    const item = live.get(token);
    if (!item) return null;
    const { reminder } = item;
    return {
      title: reminder.title,
      kind: reminder.kind,
      minutes: reminder.minutes,
      canComplete: item.source === 'task',
      snoozed: item.snoozed,
    };
  });

  const onAct = (event: IpcMainEvent, token: unknown, action: unknown) => {
    if (!trusted(event) || typeof token !== 'string') return;
    if (!REMINDER_ACTIONS.includes(action as ReminderToastAction)) return;
    const item = live.get(token);
    if (!item) return;
    dismiss(token);
    if (action === 'complete' && item.source === 'task') {
      void completeTask(item.reminder.taskId);
    } else if (action === 'snooze') {
      const timer = setTimeout(() => {
        snoozeTimers.delete(timer);
        show({ ...item.reminder, kind: 'due', minutes: 0 }, item.source, true);
      }, REMINDER_SNOOZE_MS);
      snoozeTimers.add(timer);
    }
  };
  ipcMain.on(IPC.reminderAct, onAct);

  return {
    show,
    close() {
      disposed = true;
      for (const token of [...live.keys()]) dismiss(token);
      for (const t of snoozeTimers) clearTimeout(t);
      snoozeTimers.clear();
      ipcMain.removeHandler(IPC.reminderGet);
      ipcMain.removeListener(IPC.reminderAct, onAct);
    },
  };
}
