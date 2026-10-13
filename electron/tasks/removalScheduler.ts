import {
  UNDO_WINDOW_MS,
  fail,
  isTaskId,
  ok,
  type PendingRemoval,
  type Task,
  type TaskLists,
  type TaskRepository,
  type TaskResult,
  type TaskSnapshot,
} from '../../shared/tasks.ts';

export interface RemovalSchedulerOptions {
  /** Prazo para desfazer (ms). */
  windowMs?: number;
  now?: () => Date;
  /** Temporizadores injetáveis (os testes controlam o tempo). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** O conjunto de exclusões pendentes mudou (agendou, desfez ou finalizou). */
  onChange?: () => void;
}

interface Entry {
  expiresAt: number;
  handle: unknown;
}

/**
 * Exclusão com "Desfazer". Agendar NÃO apaga nada: a tarefa só some das listas
 * que as janelas veem. O `DELETE` acontece quando o prazo termina.
 *
 * Regras:
 *  - desfazer cancela a exclusão sem tocar nos dados;
 *  - se o app fechar durante o prazo, as exclusões pendentes são CANCELADAS
 *    (`dispose`) e as tarefas continuam no banco: nada é apagado antes do prazo;
 *  - uma concluída que a política de 30 dias removeu durante o prazo não pode
 *    ser restaurada (o banco é a fonte de verdade).
 */
export class RemovalScheduler {
  private readonly repo: TaskRepository;
  private readonly windowMs: number;
  private readonly now: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly onChange: () => void;
  private readonly entries = new Map<string, Entry>();

  constructor(repo: TaskRepository, options: RemovalSchedulerOptions = {}) {
    this.repo = repo;
    this.windowMs = options.windowMs ?? UNDO_WINDOW_MS;
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onChange = options.onChange ?? (() => {});
  }

  isPending(id: string): boolean {
    return this.entries.has(id);
  }

  /** Agenda a exclusão. Idempotente: agendar de novo devolve o mesmo prazo. */
  async schedule(id: string): Promise<TaskResult<PendingRemoval>> {
    if (!isTaskId(id)) return fail('invalid_id', 'Identificador de tarefa inválido.');
    const found = await this.repo.get(id);
    if (!found.ok) return found;
    // Outra chamada pode ter agendado enquanto esperávamos o banco.
    const existing = this.entries.get(id);
    if (existing) return ok({ task: found.value, expiresAt: new Date(existing.expiresAt).toISOString() });

    const expiresAt = this.now().getTime() + this.windowMs;
    const handle = this.setTimer(() => void this.finalize(id), this.windowMs);
    this.entries.set(id, { expiresAt, handle });
    this.onChange();
    return ok({ task: found.value, expiresAt: new Date(expiresAt).toISOString() });
  }

  /** Cancela a exclusão. Falha se o prazo acabou ou a tarefa já não existe. */
  async undo(id: string): Promise<TaskResult<Task>> {
    if (!isTaskId(id)) return fail('invalid_id', 'Identificador de tarefa inválido.');
    const entry = this.entries.get(id);
    if (!entry) return fail('not_found', 'O prazo para desfazer terminou.');
    // Cancela ANTES de consultar o banco: assim o temporizador não pode apagar a
    // tarefa no meio do desfazer.
    this.clearTimer(entry.handle);
    this.entries.delete(id);
    const found = await this.repo.get(id);
    this.onChange();
    if (!found.ok) return fail('not_found', 'A tarefa expirou e não pode ser restaurada.');
    return found;
  }

  /** O prazo terminou: agora sim a exclusão é definitiva. */
  private async finalize(id: string): Promise<void> {
    if (!this.entries.delete(id)) return; // já desfeita
    try {
      await this.repo.remove(id); // "não existe mais" (ex.: retenção) também é aceitável
    } catch (error) {
      console.error('Falha ao concluir a exclusão agendada:', error);
    }
    this.onChange();
  }

  /**
   * Monta o que as janelas veem: as pendentes saem das listas e aparecem em
   * `pendingRemovals`. Entradas cujo registro já não existe (retenção) são descartadas.
   */
  snapshot(lists: TaskLists): TaskSnapshot {
    const byId = new Map<string, Task>();
    for (const t of [...lists.active, ...lists.completed]) byId.set(t.id, t);

    const pendingRemovals: PendingRemoval[] = [];
    for (const [id, entry] of [...this.entries]) {
      const task = byId.get(id);
      if (!task) {
        this.clearTimer(entry.handle);
        this.entries.delete(id);
        continue;
      }
      pendingRemovals.push({ task, expiresAt: new Date(entry.expiresAt).toISOString() });
    }
    pendingRemovals.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    return {
      active: lists.active.filter((t) => !this.entries.has(t.id)),
      completed: lists.completed.filter((t) => !this.entries.has(t.id)),
      pendingRemovals,
    };
  }

  /** Encerra sem apagar nada: as exclusões pendentes são canceladas. */
  dispose(): void {
    for (const entry of this.entries.values()) this.clearTimer(entry.handle);
    this.entries.clear();
  }
}
