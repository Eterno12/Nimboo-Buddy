import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  COMPLETED_RETENTION_DAYS,
  TASK_LIMIT,
  fail,
  isTaskId,
  ok,
  validateTitle,
  type Task,
  type TaskChange,
  type TaskLists,
  type TaskRepository,
  type TaskResult,
} from '../../shared/tasks.ts';

export interface SqliteTaskRepositoryOptions {
  /** Relógio injetável (os testes controlam o tempo). */
  now?: () => Date;
  newId?: () => string;
  retentionDays?: number;
  /** Chamado depois que uma mudança foi confirmada (commit). */
  onChange?: (change: TaskChange) => void;
}

interface Row {
  id: string;
  title: string;
  completed: number;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

const toTask = (r: Row): Task => ({
  id: r.id,
  title: r.title,
  completed: r.completed === 1,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  updatedAt: r.updated_at,
});

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tarefas em SQLite local. É a fonte de verdade: nada é guardado em memória.
 * Todas as escritas acontecem em transações (`BEGIN IMMEDIATE`), de modo que
 * várias conexões/processos nunca deixam o banco inconsistente.
 */
export class SqliteTaskRepository implements TaskRepository {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly retentionMs: number;
  private readonly onChange: (change: TaskChange) => void;

  constructor(db: DatabaseSync, options: SqliteTaskRepositoryOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
    this.retentionMs = (options.retentionDays ?? COMPLETED_RETENTION_DAYS) * DAY_MS;
    this.onChange = options.onChange ?? (() => {});
  }

  /**
   * Avisa que algo mudou DEPOIS do commit. Uma falha do ouvinte (por exemplo, uma
   * janela que já foi destruída) nunca pode fazer uma operação já confirmada
   * parecer malsucedida: o erro é só registrado.
   */
  private notify(change: TaskChange): void {
    try {
      this.onChange(change);
    } catch (error) {
      console.error('Falha ao notificar a mudança de tarefas (a operação foi concluída):', error);
    }
  }

  /** Executa `fn` em uma transação; desfaz tudo se algo lançar. */
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Apaga concluídas com mais de N dias. Retorna quantas foram removidas. */
  private purgeInside(): number {
    const cutoff = new Date(this.now().getTime() - this.retentionMs).toISOString();
    const result = this.db.prepare('DELETE FROM tasks WHERE completed = 1 AND completed_at < ?').run(cutoff);
    return Number(result.changes);
  }

  /** Limpeza explícita (chamada na inicialização e periodicamente). */
  purgeExpired(): number {
    const count = this.transaction(() => this.purgeInside());
    if (count > 0) this.notify({ type: 'purged', count });
    return count;
  }

  private guard<T>(fn: () => TaskResult<T>): TaskResult<T> {
    try {
      return fn();
    } catch (error) {
      console.error('Falha no armazenamento de tarefas:', error);
      return fail('storage', 'Não foi possível acessar as tarefas salvas.');
    }
  }

  async list(): Promise<TaskLists> {
    const purged = this.transaction(() => this.purgeInside());
    if (purged > 0) this.notify({ type: 'purged', count: purged });
    const rows = this.db
      .prepare('SELECT * FROM tasks ORDER BY completed ASC, created_at ASC, id ASC')
      .all() as unknown as Row[];
    const tasks = rows.map(toTask);
    return {
      active: tasks.filter((t) => !t.completed),
      completed: tasks
        .filter((t) => t.completed)
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    };
  }

  async get(id: string): Promise<TaskResult<Task>> {
    if (!isTaskId(id)) return fail('invalid_id', 'Identificador de tarefa inválido.');
    let purged = 0;
    const result = this.guard(() =>
      this.transaction((): TaskResult<Task> => {
        purged = this.purgeInside(); // uma concluída expirada já não existe
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as Row | undefined;
        return row ? ok(toTask(row)) : fail('not_found', 'A tarefa não existe mais.');
      }),
    );
    if (purged > 0) this.notify({ type: 'purged', count: purged });
    return result;
  }
  async create(title: string): Promise<TaskResult<Task>> {
    const valid = validateTitle(title);
    if (!valid.ok) return valid;
    const result = this.guard(() => {
      const task = this.transaction((): TaskResult<Task> => {
        this.purgeInside();
        const total = this.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number };
        if (total.n >= TASK_LIMIT) return fail('limit_reached', 'Há tarefas demais guardadas. Exclua algumas.');
        const at = this.now().toISOString();
        const row: Row = {
          id: this.newId(),
          title: valid.value,
          completed: 0,
          created_at: at,
          completed_at: null,
          updated_at: at,
        };
        this.db
          .prepare(
            'INSERT INTO tasks (id, title, completed, created_at, completed_at, updated_at) VALUES (?, ?, 0, ?, NULL, ?)',
          )
          .run(row.id, row.title, row.created_at, row.updated_at);
        return ok(toTask(row));
      });
      return task;
    });
    if (result.ok) this.notify({ type: 'created', id: result.value.id });
    return result;
  }

  /** Marca a conclusão (`true`) ou reabre (`false`). Idempotente. */
  private setCompleted(id: string, completed: boolean): TaskResult<Task> & { changed?: boolean } {
    if (!isTaskId(id)) return fail('invalid_id', 'Identificador de tarefa inválido.');
    return this.guard(() =>
      this.transaction((): TaskResult<Task> & { changed?: boolean } => {
        this.purgeInside();
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as Row | undefined;
        if (!row) return fail('not_found', 'A tarefa não existe mais.');
        if ((row.completed === 1) === completed) return { ...ok(toTask(row)), changed: false };
        const at = this.now().toISOString();
        this.db
          .prepare('UPDATE tasks SET completed = ?, completed_at = ?, updated_at = ? WHERE id = ?')
          .run(completed ? 1 : 0, completed ? at : null, at, id);
        const updated = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as Row;
        return { ...ok(toTask(updated)), changed: true };
      }),
    );
  }

  async complete(id: string): Promise<TaskResult<Task>> {
    const result = this.setCompleted(id, true);
    if (result.ok && result.changed) this.notify({ type: 'completed', id });
    return result.ok ? ok(result.value) : result;
  }

  async reopen(id: string): Promise<TaskResult<Task>> {
    const result = this.setCompleted(id, false);
    if (result.ok && result.changed) this.notify({ type: 'reopened', id });
    return result.ok ? ok(result.value) : result;
  }

  async remove(id: string): Promise<TaskResult<null>> {
    if (!isTaskId(id)) return fail('invalid_id', 'Identificador de tarefa inválido.');
    const result = this.guard(() =>
      this.transaction((): TaskResult<null> => {
        const r = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        return Number(r.changes) === 0 ? fail('not_found', 'A tarefa não existe mais.') : ok(null);
      }),
    );
    if (result.ok) this.notify({ type: 'removed', id });
    return result;
  }
}
