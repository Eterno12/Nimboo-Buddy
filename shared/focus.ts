/**
 * Modo foco (temporizador). Contrato e regras puras, sem Electron nem React.
 * O relógio vive no processo principal; as janelas só exibem o estado.
 */

export type FocusKind = 'focus' | 'break';
export type FocusStatus = 'idle' | 'running' | 'paused' | 'finished';

/** Durações sugeridas (minutos) e limites aceitos. */
export const FOCUS_PRESET_MINUTES = [15, 25, 45, 60] as const;
export const DEFAULT_FOCUS_MINUTES = 25;
export const DEFAULT_BREAK_MINUTES = 5;
export const DEFAULT_LONG_BREAK_MINUTES = 15;
/** No ciclo Pomodoro, a cada quantos focos concluídos vem a pausa longa. */
export const POMODORO_EVERY = 4;
export const FOCUS_MIN_MINUTES = 1;
export const FOCUS_MAX_MINUTES = 180;
export const BREAK_MIN_MINUTES = 1;
export const BREAK_MAX_MINUTES = 60;

/** Próximo passo sugerido ao fim de uma sessão. */
export interface NextStep {
  kind: FocusKind;
  minutes: number;
  /** É a pausa longa do ciclo Pomodoro. */
  long: boolean;
}

/** Tarefa vinculada a uma sessão (o título é copiado: a tarefa pode ser concluída ou excluída). */
export interface FocusTask {
  id: string;
  title: string;
}

export interface FocusState {
  status: FocusStatus;
  /** O que está (ou esteve) em andamento: foco ou pausa. */
  kind: FocusKind;
  /** Duração total da sessão atual, em ms. */
  durationMs: number;
  /**
   * Em `running`: instante de término (ms desde a época, relógio do sistema).
   * Nos demais estados: `null`.
   */
  endsAt: number | null;
  /** Tempo restante no momento em que o estado foi emitido (fixo em `paused`/`idle`/`finished`). */
  remainingMs: number;
  /** Tarefa vinculada à sessão (só foco), ou `null`. */
  task: FocusTask | null;
  /** Focos concluídos no ciclo Pomodoro atual (0..POMODORO_EVERY). */
  cycleCount: number;
  /** O ciclo Pomodoro está ligado (mostra "foco 2 de 4" e usa pausa longa). */
  cycleEnabled: boolean;
  /** Em `finished`: o que vem a seguir (a interface oferece iniciar). */
  next: NextStep | null;
}

export const IDLE_FOCUS_STATE: FocusState = Object.freeze({
  status: 'idle',
  kind: 'focus',
  durationMs: DEFAULT_FOCUS_MINUTES * 60_000,
  endsAt: null,
  remainingMs: DEFAULT_FOCUS_MINUTES * 60_000,
  task: null,
  cycleCount: 0,
  cycleEnabled: false,
  next: null,
});

/** Configuração do temporizador (vem das preferências). */
export interface FocusConfig {
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  /** Ciclo Pomodoro: pausa longa a cada POMODORO_EVERY focos. */
  cycle: boolean;
  /** Com o ciclo ligado, inicia a próxima etapa sozinho depois de uns segundos. */
  autoAdvance: boolean;
}

export const DEFAULT_FOCUS_CONFIG: Readonly<FocusConfig> = Object.freeze({
  focusMinutes: DEFAULT_FOCUS_MINUTES,
  breakMinutes: DEFAULT_BREAK_MINUTES,
  longBreakMinutes: DEFAULT_LONG_BREAK_MINUTES,
  cycle: false,
  autoAdvance: false,
});

/** Estatística do dia (calculada no main, a partir das sessões concluídas). */
export interface FocusStats {
  /** Sessões de foco concluídas hoje. */
  sessions: number;
  /** Minutos de foco concluídos hoje. */
  minutes: number;
}

export type FocusErrorCode =
  | 'invalid_kind'
  | 'invalid_duration'
  | 'invalid_task'
  | 'busy'
  | 'not_running'
  | 'not_paused'
  | 'unavailable';

export type FocusResult<T> = { ok: true; value: T } | { ok: false; error: { code: FocusErrorCode; message: string } };

export const focusOk = <T>(value: T): FocusResult<T> => ({ ok: true, value });
export const focusFail = <T = never>(code: FocusErrorCode, message: string): FocusResult<T> => ({
  ok: false,
  error: { code, message },
});

/** Limites por tipo de sessão. */
export function minutesRange(kind: FocusKind): { min: number; max: number } {
  return kind === 'focus'
    ? { min: FOCUS_MIN_MINUTES, max: FOCUS_MAX_MINUTES }
    : { min: BREAK_MIN_MINUTES, max: BREAK_MAX_MINUTES };
}

/** Valida o tipo e a duração (inteiro de minutos dentro do limite). */
export function validateSession(kind: unknown, minutes: unknown): FocusResult<{ kind: FocusKind; minutes: number }> {
  if (kind !== 'focus' && kind !== 'break') return focusFail('invalid_kind', 'Tipo de sessão inválido.');
  const { min, max } = minutesRange(kind);
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < min || minutes > max) {
    return focusFail('invalid_duration', `Escolha de ${min} a ${max} minutos.`);
  }
  return focusOk({ kind, minutes });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida a tarefa vinculada (`null`/ausente é válido: sessão sem tarefa). */
export function validateFocusTask(task: unknown): FocusResult<FocusTask | null> {
  if (task === null || task === undefined) return focusOk(null);
  if (typeof task !== 'object') return focusFail('invalid_task', 'Tarefa inválida.');
  const { id, title } = task as Record<string, unknown>;
  if (typeof id !== 'string' || !UUID_RE.test(id) || typeof title !== 'string') {
    return focusFail('invalid_task', 'Tarefa inválida.');
  }
  return focusOk({ id, title: title.trim().slice(0, 200) });
}

/**
 * O que sugerir depois de `finished`. Sem ciclo: foco → pausa curta → foco. Com ciclo: a pausa depois do
 * POMODORO_EVERY-ésimo foco é longa. `cycleCount` já inclui o foco que acabou de terminar.
 */
export function nextStep(kind: FocusKind, cycleCount: number, config: FocusConfig): NextStep {
  if (kind === 'break') return { kind: 'focus', minutes: config.focusMinutes, long: false };
  if (config.cycle && cycleCount >= POMODORO_EVERY) {
    return { kind: 'break', minutes: config.longBreakMinutes, long: true };
  }
  return { kind: 'break', minutes: config.breakMinutes, long: false };
}

/** Tempo restante agora (ms), a partir do estado e do relógio. */
export function remainingNow(state: FocusState, now: number): number {
  if (state.status === 'running' && state.endsAt !== null) return Math.max(0, state.endsAt - now);
  return state.remainingMs;
}

/**
 * Formata como `mm:ss` (ou `h:mm:ss` a partir de 1 h). Arredonda para CIMA: o
 * visor mostra `00:01` até o último instante e só chega a `00:00` ao terminar.
 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

/** Fração concluída (0..1), para barras de progresso. */
export function progress(state: FocusState, now: number): number {
  if (state.status === 'idle' || state.durationMs <= 0) return 0;
  if (state.status === 'finished') return 1;
  return Math.min(1, Math.max(0, 1 - remainingNow(state, now) / state.durationMs));
}

/** API do modo foco exposta ao renderer (`window.mochi.focus`). */
export interface FocusApi {
  getState(): Promise<FocusState>;
  /** Inicia uma sessão; `task` (opcional, só foco) a vincula a uma tarefa. */
  start(kind: FocusKind, minutes: number, task?: FocusTask | null): Promise<FocusResult<FocusState>>;
  pause(): Promise<FocusResult<FocusState>>;
  resume(): Promise<FocusResult<FocusState>>;
  /** Cancela a sessão (ou dispensa a mensagem de "concluído") e volta ao repouso. */
  cancel(): Promise<FocusResult<FocusState>>;
  /** Sessões e minutos de foco concluídos hoje. */
  stats(): Promise<FocusStats>;
  /** O estado mudou (início, pausa, retomada, fim, cancelamento). Não dispara a cada segundo. */
  onChange(listener: (state: FocusState) => void): () => void;
  /** Uma sessão terminou sozinha (não ao cancelar). */
  onFinished(listener: (kind: FocusKind) => void): () => void;
}
