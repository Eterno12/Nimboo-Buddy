import type { DatabaseSync } from 'node:sqlite';
import { migrate, MIGRATIONS, SchemaTooNewError, type Migration } from '../../electron/tasks/migrations.ts';
import { SqlJsDatabase, type SqlJsModule } from './sqlJsDatabase.ts';

/** Onde o arquivo do banco fica (Android: arquivo do app; navegador de desenvolvimento: IndexedDB). */
export interface BlobStore {
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  /** Guarda uma cópia do arquivo que não deu para abrir (para a pessoa/suporte recuperarem). */
  preserveCorrupt?(bytes: Uint8Array): Promise<void>;
}

export interface PersistedDb {
  db: SqlJsDatabase;
  /** O arquivo estava corrompido: começou vazio e precisa baixar tudo da nuvem. */
  recovered: boolean;
  /** Grava agora (use ao pausar o app). */
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenPersistedOptions {
  /** Espera depois da última mudança antes de gravar (mudanças seguidas viram uma gravação). */
  debounceMs?: number;
  migrations?: readonly Migration[];
}

/**
 * Abre o banco do arquivo, migra e passa a regravá-lo depois de cada transação confirmada.
 * Versão mais nova que o app: recusa SEM tocar no arquivo. Arquivo ilegível: guarda cópia e começa vazio.
 */
export async function openPersistedDb(SQL: SqlJsModule, store: BlobStore, options: OpenPersistedOptions = {}): Promise<PersistedDb> {
  const debounceMs = options.debounceMs ?? 400;
  const migrations = options.migrations ?? MIGRATIONS;
  const bytes = await store.read();
  let recovered = false;
  let db: SqlJsDatabase;

  const fresh = (): SqlJsDatabase => {
    const created = new SqlJsDatabase(SQL);
    migrate(created as unknown as DatabaseSync, migrations);
    return created;
  };

  if (bytes && bytes.length > 0) {
    try {
      db = new SqlJsDatabase(SQL, bytes);
      migrate(db as unknown as DatabaseSync, migrations);
    } catch (error) {
      if (error instanceof SchemaTooNewError) throw error;
      try {
        await store.preserveCorrupt?.(bytes);
      } catch (e) {
        console.error('Não foi possível guardar a cópia do banco corrompido:', e);
      }
      db = fresh();
      db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('needs_full_pull', '1')").run();
      recovered = true;
    }
  } else {
    db = fresh();
  }

  // Gravações em série: nunca duas ao mesmo tempo, e a última sempre vence.
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const save = (): Promise<void> => {
    chain = chain
      .then(() => (closed ? undefined : store.write(db.export())))
      .catch((error) => console.error('Falha ao gravar o banco:', error));
    return chain;
  };
  db.onCommit = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void save();
    }, debounceMs);
  };

  await store.write(db.export()); // o arquivo existe desde a primeira abertura (com a migração aplicada)

  return {
    db,
    recovered,
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await save();
    },
    async close() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await save();
      closed = true;
      db.onCommit = null;
      db.close();
    },
  };
}
