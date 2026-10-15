import { LocalNotifications } from '@capacitor/local-notifications';
import { focusEndText, type Notifier } from './notifier';

/** Id fixo: só existe um aviso de fim de sessão por vez (agendar de novo substitui). */
const FOCUS_END_ID = 4101;

/** Notificações locais do Android (agendadas no sistema: tocam mesmo com o app fechado). */
export function nativeNotifier(): Notifier {
  return {
    async requestPermission() {
      try {
        const current = await LocalNotifications.checkPermissions();
        if (current.display === 'granted') return true;
        const asked = await LocalNotifications.requestPermissions();
        return asked.display === 'granted';
      } catch {
        return false;
      }
    },
    async scheduleFocusEnd(at, kind) {
      try {
        if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
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
  };
}
