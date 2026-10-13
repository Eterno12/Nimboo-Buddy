import type { Task } from '../shared/tasks.ts';

export type ReminderKind = 'soon' | 'due';

export interface Reminder {
  taskId: string;
  title: string;
  kind: ReminderKind;
  dueAt: string;
  /** Em `soon`: quantos minutos faltam. */
  minutes: number;
}

export interface ReminderConfig {
  enabled: boolean;
  /** Aviso antecipado (min). `0` = só na hora marcada. */
  leadMinutes: number;
}

export interface ReminderSchedulerOptions {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  config?: ReminderConfig;
  onReminder: (reminder: Reminder) => void;
}

/** Eventos que já passaram há mais que isto (ao ver a tarefa pela 1ª vez) não são anunciados. */
export const REMINDER_GRACE_MS = 60_000;
/** Maior espera de um único timer (o SO limita em ~24 dias; revisitar de tempos em tempos é mais seguro). */
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;
/** Margem para tratar um evento como "agora" (o timer do SO pode disparar um pouco antes). */
const EPSILON_MS = 50;

interface Pending {
  key: string;
  at: number;
  reminder: Reminder;
}

type Candidate = Pick<Task, 'id' | 'title' | 'dueAt' | 'completed'>;

/**
 * Agenda os lembretes de prazo: um aviso `lead` minutos antes e outro na hora marcada. Cada
 * (tarefa, prazo, tipo) é anunciado no máximo UMA vez por execução do app; mudar o prazo cria
 * novos eventos. Tarefas já vencidas ao abrir o app não são anunciadas (aparecem como atrasadas).
 */
export class ReminderScheduler {
  private config: ReminderConfig;
  private tasks: Candidate[] = [];
  private readonly fired = new Set<string>();
  private handle: unknown = undefined;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly onReminder: (reminder: Reminder) => void;

  constructor(options: ReminderSchedulerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onReminder = options.onReminder;
    this.config = { ...(options.config ?? { enabled: true, leadMinutes: 10 }) };
  }

  setConfig(config: ReminderConfig): void {
    this.config = { ...config };
    this.reschedule();
  }

  /** Recebe a lista atual de tarefas (ativas ou não; só as ativas com prazo importam). */
  sync(tasks: readonly Candidate[]): void {
    this.tasks = tasks.filter((t) => !t.completed && t.dueAt !== null).map((t) => ({ ...t }));
    this.reschedule();
  }

  dispose(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.handle !== undefined) this.clearTimer(this.handle);
    this.handle = undefined;
  }

  /** Todos os eventos futuros (ou recém-passados) ainda não anunciados. */
  private pending(): Pending[] {
    if (!this.config.enabled) return [];
    const now = this.now();
    const out: Pending[] = [];
    for (const task of this.tasks) {
      const dueMs = Date.parse(task.dueAt as string);
      if (!Number.isFinite(dueMs)) continue;
      const events: { kind: ReminderKind; at: number }[] = [{ kind: 'due', at: dueMs }];
      if (this.config.leadMinutes > 0) {
        events.push({ kind: 'soon', at: dueMs - this.config.leadMinutes * 60_000 });
      }
      for (const e of events) {
        const key = `${task.id}|${task.dueAt}|${e.kind}`;
        if (this.fired.has(key)) continue;
        if (e.at < now - REMINDER_GRACE_MS) continue; // já passou: não anuncia retroativamente
        out.push({
          key,
          at: e.at,
          reminder: {
            taskId: task.id,
            title: task.title,
            kind: e.kind,
            dueAt: task.dueAt as string,
            minutes: e.kind === 'soon' ? this.config.leadMinutes : 0,
          },
        });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  private reschedule(): void {
    this.cancel();
    const pending = this.pending();
    if (pending.length === 0) return;
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, pending[0].at - this.now()));
    this.handle = this.setTimer(() => this.onTimer(), wait);
  }

  private onTimer(): void {
    this.handle = undefined;
    const now = this.now();
    for (const p of this.pending()) {
      if (p.at > now + EPSILON_MS) break;
      this.fired.add(p.key);
      try {
        this.onReminder(p.reminder);
      } catch (error) {
        console.error('Falha ao entregar um lembrete:', error);
      }
    }
    this.reschedule();
  }
}
