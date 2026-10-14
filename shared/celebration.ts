/**
 * Comemoração de tarefa difícil: regras puras. "Difícil" é só uma leitura gentil do que a própria pessoa
 * marcou ou deixou acontecer (prioridade alta, atraso, subtarefas, tarefa antiga); nunca é uma cobrança.
 */

export type HardReason = 'priority' | 'late' | 'subtasks' | 'old';

export interface HardInput {
  priority: number;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Subtarefas da tarefa concluída. */
  subtasks: number;
  /** É ela própria uma subtarefa (não comemora em dobro). */
  isSubtask: boolean;
}

/** Quantos dias uma tarefa "esperando" precisa ter para contar como "rondando há dias". */
export const OLD_AFTER_DAYS = 3;
/** Subtarefas a partir das quais a tarefa é "grande". */
export const BIG_SUBTASKS = 2;

export function hardReason(t: HardInput): HardReason | null {
  if (t.isSubtask || !t.completedAt) return null;
  const done = new Date(t.completedAt).getTime();
  if (Number.isNaN(done)) return null;
  if (t.priority >= 3) return 'priority';
  if (t.dueAt) {
    const due = new Date(t.dueAt).getTime();
    if (!Number.isNaN(due) && done > due) return 'late';
  }
  if (t.subtasks >= BIG_SUBTASKS) return 'subtasks';
  const created = new Date(t.createdAt).getTime();
  if (!Number.isNaN(created) && done - created >= OLD_AFTER_DAYS * 24 * 3_600_000) return 'old';
  return null;
}

/** Falas do balão (cabem em 56 caracteres). */
export const HARD_TEXT: Record<HardReason, string> = {
  priority: 'Prioridade alta riscada! Que orgulho!',
  late: 'Atrasada, mas resolvida! Mandou bem!',
  subtasks: 'Tarefa grande concluída! Arrasou!',
  old: 'Essa rondava há dias. Resolvida!',
};
