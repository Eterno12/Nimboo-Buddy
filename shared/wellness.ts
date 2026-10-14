/**
 * Bem-estar: lembretes gentis de água, postura e descanso dos olhos. Lógica pura (sem relógio nem DOM):
 * quem chama passa o instante atual. Cada lembrete só vale se estiver ligado; vem tudo DESLIGADO por padrão.
 */

export type WellnessKind = 'water' | 'posture' | 'eyes';

export const WELLNESS_KINDS: readonly WellnessKind[] = ['water', 'posture', 'eyes'];

export interface WellnessRule {
  on: boolean;
  /** Intervalo, em minutos. */
  minutes: number;
}

export type WellnessConfig = Record<WellnessKind, WellnessRule>;

/** Intervalos permitidos (o seletor das preferências e a validação usam a mesma lista). */
export const WELLNESS_INTERVALS: Record<WellnessKind, readonly number[]> = {
  water: [30, 45, 60, 90, 120],
  posture: [20, 30, 45, 60],
  eyes: [20, 30, 45, 60],
};

export const WELLNESS_DEFAULT_MINUTES: Record<WellnessKind, number> = { water: 60, posture: 45, eyes: 20 };

export const WELLNESS_LABEL: Record<WellnessKind, string> = {
  water: 'Beber água',
  posture: 'Ajeitar a postura',
  eyes: 'Descansar os olhos',
};

/** Falas curtas (cabem no balão: até 56 caracteres), em rodízio. */
export const WELLNESS_TEXT: Record<WellnessKind, readonly string[]> = {
  water: ['Que tal um golinho de água?', 'Hora de hidratar! 💧', 'Água por perto? Beba um pouco.'],
  posture: ['Ajeite as costas e relaxe os ombros.', 'Postura! Costas retas, ombros soltos.', 'Que tal se alongar um instante?'],
  eyes: ['Olhe para longe por 20 segundos.', 'Descanse os olhos: olhe pela janela.', 'Pisque bastante e olhe ao longe.'],
};

/** Depois de uma sessão de foco: levantar e alongar. */
export const STRETCH_TEXT = 'Bom foco! Levante e alongue um pouco.';

/** Entre dois lembretes quaisquer, no mínimo isto (evita rajada quando vários vencem juntos). */
export const MIN_GAP_MS = 2 * 60_000;

export interface WellnessState {
  last: Record<WellnessKind, number>;
  lastAny: number;
  /** Quantos de cada tipo já saíram (escolhe a frase em rodízio). */
  count: Record<WellnessKind, number>;
}

export function initWellness(now: number): WellnessState {
  return {
    last: { water: now, posture: now, eyes: now },
    lastAny: now,
    count: { water: 0, posture: 0, eyes: 0 },
  };
}

export interface Nudge {
  kind: WellnessKind;
  text: string;
}

/**
 * O que lembrar agora, se algo venceu. `blocked` (foco, janela oculta...) adia sem perder o vencimento.
 * O mais atrasado vem primeiro. Não altera `state`: confirme com `commitNudge` depois de mostrar.
 */
export function dueNudge(state: WellnessState, config: WellnessConfig, now: number, blocked: boolean): Nudge | null {
  if (blocked) return null;
  if (now - state.lastAny < MIN_GAP_MS) return null;
  let best: { kind: WellnessKind; overdue: number } | null = null;
  for (const kind of WELLNESS_KINDS) {
    const rule = config[kind];
    if (!rule.on) continue;
    const overdue = now - state.last[kind] - rule.minutes * 60_000;
    if (overdue >= 0 && (!best || overdue > best.overdue)) best = { kind, overdue };
  }
  if (!best) return null;
  const texts = WELLNESS_TEXT[best.kind];
  return { kind: best.kind, text: texts[state.count[best.kind] % texts.length] };
}

export function commitNudge(state: WellnessState, kind: WellnessKind, now: number): WellnessState {
  return {
    last: { ...state.last, [kind]: now },
    lastAny: now,
    count: { ...state.count, [kind]: state.count[kind] + 1 },
  };
}

/** Ligar um lembrete (ou mudar o intervalo) recomeça a contagem dele a partir de agora. */
export function restartKind(state: WellnessState, kind: WellnessKind, now: number): WellnessState {
  return { ...state, last: { ...state.last, [kind]: now } };
}
