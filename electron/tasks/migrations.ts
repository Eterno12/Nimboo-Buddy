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
  {
    // Origem da tarefa (hoje: o id do evento da agenda de onde ela veio). Índice único parcial:
    // no máximo uma tarefa por origem, o que torna "Virar tarefa" idempotente mesmo com duas janelas.
    version: 3,
    name: 'task_source_ref',
    up(db) {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN source_ref TEXT;
        CREATE UNIQUE INDEX idx_tasks_source_ref ON tasks (source_ref) WHERE source_ref IS NOT NULL;
      `);
    },
  },
  {
    // Notas com formatação: o documento do editor (JSON) + título/prévia/texto derivados para a lista e a
    // busca. `pinned` = aberta como nota flutuante na área de trabalho, com a última posição/tamanho.
    version: 4,
    name: 'notes',
    up(db) {
      db.exec(`
        CREATE TABLE notes (
          id         TEXT    NOT NULL PRIMARY KEY,
          title      TEXT    NOT NULL,
          preview    TEXT    NOT NULL DEFAULT '',
          plain      TEXT    NOT NULL DEFAULT '',
          doc        TEXT    NOT NULL,
          color      TEXT    NOT NULL DEFAULT 'yellow',
          pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
          win_x      INTEGER,
          win_y      INTEGER,
          win_w      INTEGER,
          win_h      INTEGER,
          created_at TEXT    NOT NULL,
          updated_at TEXT    NOT NULL
        ) STRICT;
        CREATE INDEX idx_notes_updated ON notes (updated_at);
        CREATE INDEX idx_notes_pinned ON notes (pinned) WHERE pinned = 1;
      `);
    },
  },
  {
    // Tarefas completas: prioridade, repetição, subtarefas (parent_id, um nível) e ordem manual.
    version: 5,
    name: 'task_priority_recurrence_subtasks_position',
    up(db) {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3);
        ALTER TABLE tasks ADD COLUMN recurrence TEXT CHECK (recurrence IN ('daily', 'weekdays', 'weekly', 'monthly'));
        ALTER TABLE tasks ADD COLUMN parent_id TEXT;
        ALTER TABLE tasks ADD COLUMN position REAL;
        CREATE INDEX idx_tasks_parent ON tasks (parent_id) WHERE parent_id IS NOT NULL;
      `);
    },
  },
  {
    // Notas ligadas a uma tarefa (anotações da tarefa) ou a um evento da agenda (pauta). No máximo uma
    // nota por tarefa e uma por evento (índices únicos parciais).
    version: 6,
    name: 'note_links',
    up(db) {
      db.exec(`
        ALTER TABLE notes ADD COLUMN task_id TEXT;
        ALTER TABLE notes ADD COLUMN event_ref TEXT;
        CREATE UNIQUE INDEX idx_notes_task ON notes (task_id) WHERE task_id IS NOT NULL;
        CREATE UNIQUE INDEX idx_notes_event ON notes (event_ref) WHERE event_ref IS NOT NULL;
      `);
    },
  },
  {
    // Vínculo com o Nimboo: contadores (JSON em `bond_kv`: stats, days, affection) e conquistas desbloqueadas.
    version: 7,
    name: 'bond_and_achievements',
    up(db) {
      db.exec(`
        CREATE TABLE bond_kv (
          key   TEXT NOT NULL PRIMARY KEY,
          value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE achievements (
          id          TEXT NOT NULL PRIMARY KEY,
          unlocked_at TEXT NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    // Histórico da conversa com o assistente (visível e apagável pela pessoa).
    version: 8,
    name: 'assistant_history',
    up(db) {
      db.exec(`
        CREATE TABLE assistant_history (
          seq   INTEGER PRIMARY KEY AUTOINCREMENT,
          role  TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          text  TEXT NOT NULL,
          label TEXT,
          url   TEXT,
          at    TEXT NOT NULL
        );
      `);
    },
  },
  {
    // Preparação para sincronizar (D55): identidade do aparelho, fila de saída durável e marcas de exclusão.
    // Tudo é mantido por gatilhos, na MESMA transação de cada mudança, para nenhuma escrita escapar da fila.
    // Exclusões feitas pela limpeza de 30 dias ligam `sync_ctx.suppress` e não viram exclusão sincronizada.
    version: 9,
    name: 'sync_foundations',
    up(db) {
      db.exec(`
        ALTER TABLE tasks ADD COLUMN origin TEXT;
        ALTER TABLE notes ADD COLUMN origin TEXT;
        ALTER TABLE focus_sessions ADD COLUMN origin TEXT;
        CREATE TABLE sync_meta (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL) STRICT;
        INSERT INTO sync_meta (key, value) VALUES ('device_id', lower(hex(randomblob(16))));
        INSERT INTO sync_meta (key, value) VALUES ('protocol', '1');
        CREATE TABLE sync_ctx (id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1), suppress INTEGER NOT NULL DEFAULT 0) STRICT;
        INSERT INTO sync_ctx (id, suppress) VALUES (1, 0);
        CREATE TABLE outbox (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          tbl TEXT NOT NULL,
          id  TEXT NOT NULL,
          op  TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
          at  TEXT NOT NULL
        );
        CREATE INDEX idx_outbox_row ON outbox (tbl, id);
        CREATE TABLE tombstones (
          tbl        TEXT NOT NULL,
          id         TEXT NOT NULL,
          deleted_at TEXT NOT NULL,
          origin     TEXT,
          PRIMARY KEY (tbl, id)
        ) STRICT;
      `);
      for (const table of ['tasks', 'notes', 'focus_sessions']) {
        const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
        const device = "(SELECT value FROM sync_meta WHERE key = 'device_id')";
        const quiet = '(SELECT suppress FROM sync_ctx) = 0';
        // A exclusão vale como "depois da última edição" mesmo com o relógio local atrasado.
        const last = table === 'focus_sessions' ? 'OLD.completed_at' : 'OLD.updated_at';
        db.exec(`
          CREATE TRIGGER trg_${table}_sync_ins AFTER INSERT ON ${table} WHEN ${quiet} BEGIN
            UPDATE ${table} SET origin = ${device} WHERE id = NEW.id;
            DELETE FROM tombstones WHERE tbl = '${table}' AND id = NEW.id;
            INSERT INTO outbox (tbl, id, op, at) VALUES ('${table}', NEW.id, 'upsert', ${now});
          END;
          CREATE TRIGGER trg_${table}_sync_upd AFTER UPDATE ON ${table} WHEN ${quiet} AND NEW.origin IS OLD.origin BEGIN
            UPDATE ${table} SET origin = ${device} WHERE id = NEW.id;
            INSERT INTO outbox (tbl, id, op, at) VALUES ('${table}', NEW.id, 'upsert', ${now});
          END;
          CREATE TRIGGER trg_${table}_sync_del AFTER DELETE ON ${table} WHEN ${quiet} BEGIN
            INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at, origin) VALUES ('${table}', OLD.id, max(${now}, ${last}), ${device});
            INSERT INTO outbox (tbl, id, op, at) VALUES ('${table}', OLD.id, 'delete', ${now});
          END;
        `);
      }
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
