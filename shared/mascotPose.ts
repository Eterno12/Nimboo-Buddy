/**
 * Pose do mascote nos lugares que não animam (widget da tela inicial): uma imagem por estado, escolhida por
 * regras simples sobre o dia da pessoa. Pura, igual no app e nos testes.
 */
export type WidgetPose = 'idle' | 'happy' | 'curious' | 'sleepy' | 'celebrate' | 'surprised';

export const WIDGET_POSES: readonly WidgetPose[] = ['idle', 'happy', 'curious', 'sleepy', 'celebrate', 'surprised'];

export interface PoseInput {
  now: number;
  /** Tarefas atrasadas (principais, ativas). */
  overdue: number;
  /** Minutos até o próximo prazo (ou `null` sem prazos futuros). */
  nextDueInMin: number | null;
  /** Há quanto tempo (ms) a última tarefa foi concluída (ou `null`). */
  lastCompletedMsAgo: number | null;
  /** Hora local (0–23). */
  hour: number;
}

/** Quanto tempo a comemoração dura depois de concluir algo. */
export const CELEBRATE_MS = 10 * 60_000;
/** "Prazo perto": o Nimboo fica curioso. */
export const CURIOUS_WITHIN_MIN = 30;

/** Concluir > atraso > prazo perto > noite/madrugada > repouso. */
export function poseFor(i: PoseInput): WidgetPose {
  if (i.lastCompletedMsAgo !== null && i.lastCompletedMsAgo >= 0 && i.lastCompletedMsAgo <= CELEBRATE_MS) return 'celebrate';
  if (i.overdue > 0) return 'surprised';
  if (i.nextDueInMin !== null && i.nextDueInMin >= 0 && i.nextDueInMin <= CURIOUS_WITHIN_MIN) return 'curious';
  if (i.hour >= 22 || i.hour < 6) return 'sleepy';
  return 'idle';
}
