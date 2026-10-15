import {
  DEFAULT_FOCUS_CONFIG,
  IDLE_FOCUS_STATE,
  POMODORO_EVERY,
  focusFail,
  focusOk,
  nextStep,
  remainingNow,
  validateFocusTask,
  validateSession,
  type FocusConfig,
  type FocusKind,
  type FocusResult,
  type FocusState,
  type FocusTask,
} from '../../shared/focus.ts';

/** Dados de uma sessão que terminou sozinha (para o registro do dia). */
export interface FinishedSession {
  kind: FocusKind;
  minutes: number;
  task: FocusTask | null;
  /** Instante do fim (ms desde a época). */
  at: number;
}

export interface FocusTimerOptions {
  /** Relógio (ms desde a época). Injetável nos testes. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  config?: FocusConfig;
  /** Chamado a cada mudança de estado (nunca a cada segundo). */
  onChange?: (state: FocusState) => void;
  /** Chamado uma vez quando uma sessão termina sozinha. */
  onFinished?: (kind: FocusKind, session: FinishedSession) => void;
}

/** Margem para considerar que o prazo chegou (o timer do SO pode disparar ~1 ms antes). */
const EPSILON_MS = 5;

/**
 * Temporizador do modo foco: uma sessão por vez (foco ou pausa).
 *
 * - Usa o relógio do sistema (`endsAt`): se o computador dormir, a sessão termina
 *   no horário real, e ao acordar o timer é reavaliado em vez de confiar no atraso.
 * - Pausar guarda o tempo restante; retomar recalcula o novo `endsAt`.
 * - Ciclo Pomodoro opcional: conta os focos concluídos; a pausa depois do 4º é longa e fecha o ciclo.
 * - Não persiste nada: encerrar o app encerra a sessão (decisão v1, ver `DECISIONS.md`).
 */
export class FocusTimer {
  private config: FocusConfig;
  private state: FocusState;
  private handle: unknown = undefined;
  /** A pausa em andamento é a longa do ciclo (ao terminar, o ciclo recomeça). */
  private longBreak = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly onChange: (state: FocusState) => void;
  private readonly onFinished: (kind: FocusKind, session: FinishedSession) => void;

  constructor(options: FocusTimerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onChange = options.onChange ?? (() => {});
    this.onFinished = options.onFinished ?? (() => {});
    this.config = { ...(options.config ?? DEFAULT_FOCUS_CONFIG) };
    this.state = this.idleState(0);
  }

  getState(): FocusState {
    return { ...this.state };
  }

  getConfig(): FocusConfig {
    return { ...this.config };
  }

  /** Atualiza a configuração (preferências mudaram). Uma sessão em andamento não é afetada. */
  configure(config: FocusConfig): void {
    const cycleChanged = config.cycle !== this.config.cycle;
    this.config = { ...config };
    if (!this.config.cycle) this.state.cycleCount = 0;
    if (this.state.status === 'idle') {
      this.state = this.idleState(this.state.cycleCount);
      this.onChange(this.getState());
      return;
    }
    const next = this.state.status === 'finished' ? nextStep(this.state.kind, this.state.cycleCount, this.config) : null;
    this.state = { ...this.state, cycleEnabled: this.config.cycle, next };
    if (cycleChanged || this.state.status === 'finished') this.onChange(this.getState());
  }

  /**
   * Inicia uma sessão. Só a partir de `idle` ou `finished`; nunca sobrescreve uma em andamento.
   * `task` (opcional) só vale para foco.
   */
  start(kind: unknown, minutes: unknown, task?: unknown): FocusResult<FocusState> {
    const valid = validateSession(kind, minutes);
    if (!valid.ok) return valid;
    const linked = validateFocusTask(task);
    if (!linked.ok) return linked;
    if (this.state.status === 'running' || this.state.status === 'paused') {
      return focusFail('busy', 'Já existe uma sessão em andamento.');
    }
    const durationMs = valid.value.minutes * 60_000;
    this.longBreak = valid.value.kind === 'break' && this.config.cycle && this.state.cycleCount >= POMODORO_EVERY;
    this.set({
      status: 'running',
      kind: valid.value.kind,
      durationMs,
      endsAt: this.now() + durationMs,
      remainingMs: durationMs,
      task: valid.value.kind === 'focus' ? linked.value : null,
      cycleCount: this.state.cycleCount,
      cycleEnabled: this.config.cycle,
      next: null,
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

  /**
   * Retoma uma sessão guardada (o app foi fechado no meio). Em andamento: continua pelo horário real e, se o
   * horário já passou, conclui na hora com o instante em que realmente terminou. Pausada: mantém o restante.
   * Estado inválido ou em repouso é ignorado.
   */
  restore(saved: FocusState): void {
    if (this.state.status === 'running' || this.state.status === 'paused') return;
    if (saved.status !== 'running' && saved.status !== 'paused') return;
    if (saved.kind !== 'focus' && saved.kind !== 'break') return;
    if (!Number.isFinite(saved.durationMs) || saved.durationMs <= 0) return;
    if (!Number.isFinite(saved.remainingMs) || saved.remainingMs < 0) return;
    const task = validateFocusTask(saved.task);
    if (!task.ok) return;
    const cycleCount = Number.isInteger(saved.cycleCount) && saved.cycleCount >= 0 ? Math.min(saved.cycleCount, POMODORO_EVERY) : 0;
    this.longBreak = saved.kind === 'break' && this.config.cycle && cycleCount >= POMODORO_EVERY;
    const base: FocusState = {
      status: saved.status,
      kind: saved.kind,
      durationMs: saved.durationMs,
      endsAt: null,
      remainingMs: saved.remainingMs,
      task: saved.kind === 'focus' ? task.value : null,
      cycleCount,
      cycleEnabled: this.config.cycle,
      next: null,
    };
    if (saved.status === 'paused') {
      this.set(base);
      return;
    }
    if (typeof saved.endsAt !== 'number' || !Number.isFinite(saved.endsAt)) return;
    this.set({ ...base, endsAt: saved.endsAt, remainingMs: Math.max(0, saved.endsAt - this.now()) });
    const left = saved.endsAt - this.now();
    if (left > EPSILON_MS) this.schedule(left);
    else this.complete(saved.endsAt);
  }

  /** Cancela (ou dispensa o "concluído") e volta ao repouso, sem disparar `onFinished`. */
  cancel(): FocusResult<FocusState> {
    this.cancelTimer();
    this.longBreak = false;
    if (this.state.status !== 'idle') this.set(this.idleState(this.state.cycleCount));
    return focusOk(this.getState());
  }

  /** Encerra sem emitir nada (usado ao fechar o app). */
  dispose(): void {
    this.cancelTimer();
  }

  private idleState(cycleCount: number): FocusState {
    const ms = this.config.focusMinutes * 60_000;
    return {
      ...IDLE_FOCUS_STATE,
      durationMs: ms,
      remainingMs: ms,
      cycleCount,
      cycleEnabled: this.config.cycle,
    };
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
    this.complete(this.now());
  }

  /** Conclui a sessão em andamento; `at` é o instante em que ela realmente terminou. */
  private complete(at: number): void {
    const { kind, task, durationMs } = this.state;
    let cycleCount = this.state.cycleCount;
    if (this.config.cycle) {
      if (kind === 'focus') cycleCount += 1;
      else if (this.longBreak) cycleCount = 0;
    }
    this.longBreak = false;
    // `next` considera o ciclo já atualizado, mas uma pausa longa recém-concluída zera a contagem
    // (o foco seguinte começa um ciclo novo).
    const next = nextStep(kind, cycleCount, this.config);
    this.set({
      ...this.state,
      status: 'finished',
      endsAt: null,
      remainingMs: 0,
      cycleCount,
      cycleEnabled: this.config.cycle,
      next,
    });
    this.onFinished(kind, {
      kind,
      minutes: Math.round(durationMs / 60_000),
      task,
      at,
    });
  }
}
