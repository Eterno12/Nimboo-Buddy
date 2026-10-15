import type { Task } from '../../shared/tasks.ts';

export type ReminderKind = 'soon' | 'due';

export interface ReminderPlan {
  /** Id numérico do aviso no sistema (estável: o mesmo aviso sempre tem o mesmo id). */
  id: number;
  taskId: string;
  kind: ReminderKind;
  /** Instante do aviso (ms desde a época). */
  at: number;
  title: string;
  body: string;
}

export interface ReminderConfig {
  enabled: boolean;
  /** Aviso antecipado em minutos (0 = só na hora marcada). */
  leadMinutes: number;
}

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = { enabled: true, leadMinutes: 10 };
export const REMINDER_LEADS = [0, 5, 10, 15, 30] as const;
/** O Android tem um limite de alarmes por app; agenda só os próximos. */
export const MAX_REMINDERS = 60;
/** Ids abaixo disto são de outros avisos do app (fim do foco etc.). */
export const REMINDER_ID_BASE = 10_000;

/** Id estável e (praticamente) único para um aviso: FNV-1a de `tarefa|tipo|prazo`. */
export function reminderId(taskId: string, kind: ReminderKind, dueAt: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${taskId}|${kind}|${dueAt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return REMINDER_ID_BASE + (h % 2_000_000_000);
}

/**
 * Quais avisos agendar agora: um `lead` minutos antes e outro na hora do prazo de cada tarefa ativa.
 * Só o futuro; subtarefas e concluídas ficam de fora; os {@link MAX_REMINDERS} mais próximos.
 */
export function planReminders(tasks: readonly Task[], now: number, config: ReminderConfig): ReminderPlan[] {
  if (!config.enabled) return [];
  const plans: ReminderPlan[] = [];
  for (const t of tasks) {
    if (t.completed || t.parentId !== null || t.dueAt === null) continue;
    const due = Date.parse(t.dueAt);
    if (!Number.isFinite(due)) continue;
    if (config.leadMinutes > 0) {
      const at = due - config.leadMinutes * 60_000;
      if (at > now) {
        plans.push({
          id: reminderId(t.id, 'soon', t.dueAt),
          taskId: t.id,
          kind: 'soon',
          at,
          title: `Em ${config.leadMinutes} minutos`,
          body: t.title,
        });
      }
    }
    if (due > now) {
      plans.push({ id: reminderId(t.id, 'due', t.dueAt), taskId: t.id, kind: 'due', at: due, title: 'Chegou a hora', body: t.title });
    }
  }
  return plans.sort((a, b) => a.at - b.at).slice(0, MAX_REMINDERS);
}
