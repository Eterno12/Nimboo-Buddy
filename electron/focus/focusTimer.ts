import {
  IDLE_FOCUS_STATE,
  focusFail,
  focusOk,
  remainingNow,
  validateSession,
  type FocusKind,
  type FocusResult,
  type FocusState,
} from '../../shared/focus.ts';

export interface FocusTimerOptions {
  /** Relógio (ms desde a época). Injetável nos testes. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Chamado a cada mudança de estado (nunca a cada segundo). */
  onChange?: (state: FocusState) => void;
  /** Chamado uma vez quando uma sessão termina sozinha. */
  onFinished?: (kind: FocusKind) => void;
}

/** Margem para considerar que o prazo chegou (o timer do SO pode disparar ~1 ms antes). */
const EPSILON_MS = 5;

/**
 * Temporizador do modo foco: uma sessão por vez (foco ou pausa).
 *
 * - Usa o relógio do sistema (`endsAt`): se o computador dormir, a sessão termina
 *   no horário real, e ao acordar o timer é reavaliado em vez de confiar no atraso.
 * - Pausar guarda o tempo restante; retomar recalcula o novo `endsAt`.
 * - Não persiste nada: encerrar o app encerra a sessão (decisão v1, ver `DECISIONS.md`).
 */
export class FocusTimer {
  private state: FocusState = { ...IDLE_FOCUS_STATE };
  private handle: unknown = undefined;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly onChange: (state: FocusState) => void;
  private readonly onFinished: (kind: FocusKind) => void;

  constructor(options: FocusTimerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onChange = options.onChange ?? (() => {});
    this.onFinished = options.onFinished ?? (() => {});
  }

  getState(): FocusState {
    return { ...this.state };
  }

  /** Inicia uma sessão. Só a partir de `idle` ou `finished`; nunca sobrescreve uma em andamento. */
  start(kind: unknown, minutes: unknown): FocusResult<FocusState> {
    const valid = validateSession(kind, minutes);
    if (!valid.ok) return valid;
    if (this.state.status === 'running' || this.state.status === 'paused') {
      return focusFail('busy', 'Já existe uma sessão em andamento.');
    }
    const durationMs = valid.value.minutes * 60_000;
    this.set({
      status: 'running',
      kind: valid.value.kind,
      durationMs,
      endsAt: this.now() + durationMs,
      remainingMs: durationMs,
    });
    this.schedule(durationMs);
    return focusOk(this.getState());
  }

  pause(): FocusResult<FocusState> {
    if (this.state.status !== 'running') return focusFail('not_running', 'Não há sessão em andamento.');
    const remaining = remainingNow(this.state, this.now());
    this.cancelTimer();
    this.set({ ...this.state, status: 'paused', endsAt: null, remainingMs: remaining });
    return focusOk(this.getState());
  }

  resume(): FocusResult<FocusState> {
    if (this.state.status !== 'paused') return focusFail('not_paused', 'A sessão não está pausada.');
    const remaining = this.state.remainingMs;
    this.set({ ...this.state, status: 'running', endsAt: this.now() + remaining });
    this.schedule(remaining);
    return focusOk(this.getState());
  }

  /** Cancela (ou dispensa o "concluído") e volta ao repouso, sem disparar `onFinished`. */
  cancel(): FocusResult<FocusState> {
    this.cancelTimer();
    if (this.state.status !== 'idle') this.set({ ...IDLE_FOCUS_STATE });
    return focusOk(this.getState());
  }

  /** Encerra sem emitir nada (usado ao fechar o app). */
  dispose(): void {
    this.cancelTimer();
  }

  private set(next: FocusState): void {
    this.state = next;
    this.onChange(this.getState());
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.handle = this.setTimer(() => this.onTimer(), Math.max(0, ms));
  }

  private cancelTimer(): void {
    if (this.handle !== undefined) this.clearTimer(this.handle);
    this.handle = undefined;
  }

  /** O timer disparou: confirma pelo relógio antes de concluir (pode ter disparado cedo). */
  private onTimer(): void {
    this.handle = undefined;
    if (this.state.status !== 'running' || this.state.endsAt === null) return;
    const left = this.state.endsAt - this.now();
    if (left > EPSILON_MS) {
      this.schedule(left);
      return;
    }
    const kind = this.state.kind;
    this.set({ ...this.state, status: 'finished', endsAt: null, remainingMs: 0 });
    this.onFinished(kind);
  }
}
