import type { ReminderPlan } from '../reminders.ts';

/** Ação tocada num aviso de tarefa (Concluir ou Adiar). */
export interface ReminderAction {
  action: 'complete' | 'snooze';
  taskId: string;
  title: string;
}

/** Avisos do sistema que o app agenda (funcionam com o app fechado no Android). */
export interface Notifier {
  /** Agenda "sessão concluída" para o instante `at` (ms desde a época), no lugar de qualquer aviso anterior. */
  scheduleFocusEnd(at: number, kind: 'focus' | 'break'): Promise<void>;
  cancelFocusEnd(): Promise<void>;
  /** Pede a permissão de notificações (Android 13+). Devolve se foi concedida. */
  requestPermission(): Promise<boolean>;
  /** Troca TODOS os avisos de prazo agendados por estes (idempotente). */
  scheduleReminders(plans: readonly ReminderPlan[]): Promise<void>;
  /** Reaparece um aviso de tarefa mais tarde ("Adiar"). */
  scheduleSnooze(taskId: string, title: string, at: number): Promise<void>;
  /** Ouve as ações Concluir/Adiar dos avisos. Devolve a função que para de ouvir. */
  onReminderAction(handler: (action: ReminderAction) => void): () => void;
}

/** Sem avisos (testes e navegador sem permissão). */
export const silentNotifier: Notifier = {
  scheduleFocusEnd: async () => {},
  cancelFocusEnd: async () => {},
  requestPermission: async () => false,
  scheduleReminders: async () => {},
  scheduleSnooze: async () => {},
  onReminderAction: () => () => {},
};

/** Texto do aviso de fim de sessão. */
export function focusEndText(kind: 'focus' | 'break'): { title: string; body: string } {
  return kind === 'focus'
    ? { title: 'Foco concluído', body: 'Boa! Hora de uma pausa.' }
    : { title: 'Pausa concluída', body: 'Pronto para focar de novo?' };
}
