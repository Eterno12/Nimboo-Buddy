/** Aviso de lembrete com botões: o que a interface do aviso recebe e pode pedir. */
export interface ReminderToastInfo {
  title: string;
  kind: 'soon' | 'due';
  /** Em `soon`: quantos minutos faltam. */
  minutes: number;
  /** Veio de uma tarefa (pode ser concluída pelo aviso); evento da agenda não. */
  canComplete: boolean;
  /** Reaparece por causa de "Adiar". */
  snoozed: boolean;
}

export type ReminderToastAction = 'complete' | 'snooze' | 'dismiss';

export const REMINDER_ACTIONS: readonly ReminderToastAction[] = ['complete', 'snooze', 'dismiss'];

/** Quanto tempo o aviso espera com "Adiar". */
export const REMINDER_SNOOZE_MS = 10 * 60_000;
/** Tempo na tela antes de sumir sozinho (o balão do mascote continua avisando). */
export const REMINDER_TOAST_MS = 30_000;
