import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { SqlJsDatabase, type SqlJsModule } from '../mobile/db/sqlJsDatabase.ts';
import { openPersistedDb, type BlobStore } from '../mobile/db/persistence.ts';
import { SchemaTooNewError } from '../electron/tasks/migrations.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { SyncStore } from '../electron/sync/syncStore.ts';

const initSqlJs = createRequire(import.meta.url)('sql.js') as () => Promise<SqlJsModule>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asNode = (db: SqlJsDatabase) => db as unknown as DatabaseSync;

function memoryStore(initial: Uint8Array | null = null) {
  const s = {
    bytes: initial,
    writes: 0,
    preserved: null as Uint8Array | null,
    read: async () => s.bytes,
    write: async (b: Uint8Array) => {
      s.bytes = new Uint8Array(b);
      s.writes++;
    },
    preserveCorrupt: async (b: Uint8Array) => {
      s.preserved = b;
    },
  };
  return s satisfies BlobStore & Record<string, unknown>;
}

test('primeira abertura cria o arquivo já com o esquema; reabrir devolve os mesmos dados', async () => {
  const SQL = await initSqlJs();
  const store = memoryStore();
  const first = await openPersistedDb(SQL, store, { debounceMs: 10 });
  assert.ok(store.bytes && store.bytes.length > 0, 'arquivo criado');
  await new SqliteTaskRepository(asNode(first.db)).create('Persistida');
  await first.flush();
  await first.close();

  const second = await openPersistedDb(SQL, store, { debounceMs: 10 });
  assert.equal((await new SqliteTaskRepository(asNode(second.db)).list()).active[0]?.title, 'Persistida');
  assert.equal(second.recovered, false);
  await second.close();
});

test('depois de cada transação o arquivo é regravado sozinho (com atraso curto); flush grava na hora', async () => {
  const SQL = await initSqlJs();
  const store = memoryStore();
  const p = await openPersistedDb(SQL, store, { debounceMs: 30 });
  const base = store.writes;
  const tasks = new SqliteTaskRepository(asNode(p.db));
  await tasks.create('A');
  await tasks.create('B');
  assert.equal(store.writes, base, 'ainda não gravou (debounce)');
  await sleep(120);
  assert.equal(store.writes, base + 1, 'várias mudanças seguidas viram uma gravação');

  await tasks.create('C');
  await p.flush();
  assert.equal(store.writes, base + 2, 'flush não espera o atraso');
  const reopened = await openPersistedDb(SQL, store, { debounceMs: 10 });
  assert.equal((await new SqliteTaskRepository(asNode(reopened.db)).list()).active.length, 3);
  await p.close();
  await reopened.close();
});

test('arquivo corrompido: guarda uma cópia, começa vazio e exige baixar tudo antes de enviar', async () => {
  const SQL = await initSqlJs();
  const junk = new TextEncoder().encode('isto não é um banco sqlite '.repeat(40));
  const store = memoryStore(junk);
  const p = await openPersistedDb(SQL, store, { debounceMs: 10 });
  assert.equal(p.recovered, true);
  assert.deepEqual(store.preserved, junk);
  assert.equal(new SyncStore(asNode(p.db)).needsFullPull(), true);
  assert.equal((await new SqliteTaskRepository(asNode(p.db)).list()).active.length, 0);
  await p.close();
});

test('banco de versão mais nova é recusado sem ser sobrescrito', async () => {
  const SQL = await initSqlJs();
  const future = new SqlJsDatabase(SQL);
  future.exec('CREATE TABLE tasks (id TEXT); PRAGMA user_version = 99;');
  const bytes = future.export();
  const store = memoryStore(bytes);
  await assert.rejects(() => openPersistedDb(SQL, store, { debounceMs: 10 }), (e: unknown) => e instanceof SchemaTooNewError);
  assert.equal(store.writes, 0);
  assert.deepEqual(store.bytes, bytes);
});
