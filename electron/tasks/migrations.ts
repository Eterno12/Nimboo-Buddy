import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  /** Versão do esquema depois de aplicar esta migração (1, 2, 3...). */
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}

/**
 * Migrações do esquema, em ordem. Regras:
 *  - nunca edite uma migração já publicada; acrescente uma nova;
 *  - cada migração preserva os dados existentes;
 *  - a versão fica em `PRAGMA user_version`.
 *
 * v1: tabela de tarefas. `id` é UUID gerado no cliente; datas em ISO 8601 UTC.
 * Não há campos de sincronização ainda. Quando houver, entram em uma nova
 * migração (por exemplo, marca de exclusão para propagar remoções).
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'create_tasks',
    up(db) {
      db.exec(`
        CREATE TABLE tasks (
          id           TEXT    NOT NULL PRIMARY KEY,
          title        TEXT    NOT NULL CHECK (length(title) > 0),
          completed    INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
          created_at   TEXT    NOT NULL,
          completed_at TEXT,
          updated_at   TEXT    NOT NULL,
          CHECK ((completed = 1 AND completed_at IS NOT NULL) OR (completed = 0 AND completed_at IS NULL))
        ) STRICT;
        CREATE INDEX idx_tasks_completed ON tasks (completed, completed_at);
      `);
    },
  },
  {
    // Prazo das tarefas (opcional) e registro das sessões de foco concluídas (estatística do dia).
    version: 2,
    name: 'due_dates_and_focus_sessions',
    up(db) {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN due_at TEXT;
        CREATE INDEX idx_tasks_due ON tasks (due_at) WHERE due_at IS NOT NULL AND completed = 0;
        CREATE TABLE focus_sessions (
          id           TEXT    NOT NULL PRIMARY KEY,
          kind         TEXT    NOT NULL CHECK (kind IN ('focus', 'break')),
          minutes      INTEGER NOT NULL CHECK (minutes > 0),
          completed_at TEXT    NOT NULL,
          task_id      TEXT
        ) STRICT;
        CREATE INDEX idx_focus_completed ON focus_sessions (completed_at);
      `);
    },
  },
];

/** O banco foi criado por uma versão mais nova do app; não é seguro abri-lo. */
export class SchemaTooNewError extends Error {
  readonly found: number;
  readonly supported: number;

  constructor(found: number, supported: number) {
    super(`O banco de dados é da versão ${found}, mas este app só entende até a ${supported}.`);
    this.name = 'SchemaTooNewError';
    this.found = found;
    this.supported = supported;
  }
}

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

/**
 * Aplica as migrações pendentes. Cada uma roda em uma transação junto com a
 * atualização da versão: se falhar, o banco continua exatamente como estava.
 */
export function migrate(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
): { from: number; to: number } {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migrações fora de ordem: esperado v${i + 1}, veio v${m.version}.`);
  });
  const latest = migrations.length;
  const from = currentVersion(db);
  if (from > latest) throw new SchemaTooNewError(from, latest);

  for (const migration of migrations.slice(from)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return { from, to: latest };
}
