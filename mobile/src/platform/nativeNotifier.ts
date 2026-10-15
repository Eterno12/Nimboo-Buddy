import { LocalNotifications } from '@capacitor/local-notifications';
import { REMINDER_ID_BASE } from '../reminders';
import { focusEndText, type Notifier, type ReminderAction } from './notifier';

/** Id fixo: só existe um aviso de fim de sessão por vez (agendar de novo substitui). */
const FOCUS_END_ID = 4101;
const TASK_ACTIONS = 'nimboo-task';

/** Notificações locais do Android (agendadas no sistema: tocam mesmo com o app fechado). */
export function nativeNotifier(): Notifier {
  let registered = false;
  const ensureActions = async () => {
    if (registered) return;
    registered = true;
    try {
      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: TASK_ACTIONS,
            actions: [
              { id: 'complete', title: 'Concluir' },
              { id: 'snooze', title: 'Adiar 10 min' },
            ],
          },
        ],
      });
    } catch (error) {
      console.error('Não foi possível registrar as ações dos avisos:', error);
    }
  };
  const granted = async () => (await LocalNotifications.checkPermissions()).display === 'granted';

  return {
    async requestPermission() {
      try {
        if (await granted()) return true;
        return (await LocalNotifications.requestPermissions()).display === 'granted';
      } catch {
        return false;
      }
    },

    async scheduleFocusEnd(at, kind) {
      try {
        if (!(await granted())) return;
        const { title, body } = focusEndText(kind);
        await LocalNotifications.cancel({ notifications: [{ id: FOCUS_END_ID }] });
        await LocalNotifications.schedule({
          notifications: [{ id: FOCUS_END_ID, title, body, schedule: { at: new Date(at), allowWhileIdle: true } }],
        });
      } catch (error) {
        console.error('Não foi possível agendar o aviso do foco:', error);
      }
    },

    async cancelFocusEnd() {
      try {
        await LocalNotifications.cancel({ notifications: [{ id: FOCUS_END_ID }] });
      } catch {
        /* nada agendado */
      }
    },

    async scheduleReminders(plans) {
      try {
        await ensureActions();
        // Troca tudo: cancela os avisos de prazo que já estavam agendados e agenda os novos.
        const pending = await LocalNotifications.getPending();
        const old = pending.notifications.filter((n) => n.id >= REMINDER_ID_BASE).map((n) => ({ id: n.id }));
        if (old.length > 0) await LocalNotifications.cancel({ notifications: old });
        if (plans.length === 0 || !(await granted())) return;
        await LocalNotifications.schedule({
          notifications: plans.map((p) => ({
            id: p.id,
            title: p.title,
            body: p.body,
            actionTypeId: TASK_ACTIONS,
            extra: { taskId: p.taskId, title: p.body },
            schedule: { at: new Date(p.at), allowWhileIdle: true },
          })),
        });
      } catch (error) {
        console.error('Não foi possível agendar os lembretes:', error);
      }
    },

    async scheduleSnooze(taskId, title, at) {
      try {
        await ensureActions();
        if (!(await granted())) return;
        // Id derivado do tempo: um adiamento novo não substitui o anterior de outra tarefa.
        const id = REMINDER_ID_BASE + 2_000_000_000 + (Math.floor(at / 1000) % 100_000_000);
        await LocalNotifications.schedule({
          notifications: [
            {
              id,
              title: 'Lembrete adiado',
              body: title,
              actionTypeId: TASK_ACTIONS,
              extra: { taskId, title },
              schedule: { at: new Date(at), allowWhileIdle: true },
            },
          ],
        });
      } catch (error) {
        console.error('Não foi possível adiar o lembrete:', error);
      }
    },

    onReminderAction(handler) {
      let handle: { remove(): Promise<void> } | null = null;
      let stopped = false;
      void LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        const extra = (event.notification.extra ?? {}) as { taskId?: unknown; title?: unknown };
        if (typeof extra.taskId !== 'string') return;
        const action: ReminderAction['action'] | null = event.actionId === 'complete' ? 'complete' : event.actionId === 'snooze' ? 'snooze' : null;
        if (!action) return; // toque no corpo do aviso: só abre o app
        handler({ action, taskId: extra.taskId, title: typeof extra.title === 'string' ? extra.title : '' });
      }).then((h) => {
        if (stopped) void h.remove();
        else handle = h;
      });
      return () => {
        stopped = true;
        void handle?.remove();
      };
    },
  };
}
