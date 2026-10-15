import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { SqlJsDatabase, type SqlJsModule } from '../mobile/db/sqlJsDatabase.ts';
import { currentVersion, migrate, MIGRATIONS } from '../electron/tasks/migrations.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { SqliteNotesRepository } from '../electron/notes/sqliteNotesRepository.ts';
import { SyncStore } from '../electron/sync/syncStore.ts';

const initSqlJs = createRequire(import.meta.url)('sql.js') as () => Promise<SqlJsModule>;

async function open(bytes?: Uint8Array) {
  const SQL = await initSqlJs();
  return new SqlJsDatabase(SQL, bytes);
}

/** O adaptador precisa servir onde o app usa `DatabaseSync`. */
const asNode = (db: SqlJsDatabase) => db as unknown as DatabaseSync;

test('adaptador: as migrações v1–v9 aplicam e a versão fica salva', async () => {
  const db = await open();
  const result = migrate(asNode(db), MIGRATIONS);
  assert.deepEqual(result, { from: 0, to: MIGRATIONS.length });
  assert.equal(currentVersion(asNode(db)), MIGRATIONS.length);
  const device = db.prepare("SELECT value FROM sync_meta WHERE key = 'device_id'").get() as { value: string };
  assert.match(device.value, /^[0-9a-f]{32}$/);
});

test('adaptador: transações (BEGIN/COMMIT/ROLLBACK) e isTransaction', async () => {
  const db = await open();
  migrate(asNode(db), MIGRATIONS);
  assert.equal(db.isTransaction, false);
  db.exec('BEGIN IMMEDIATE');
  assert.equal(db.isTransaction, true);
  db.prepare("INSERT INTO bond_kv (key, value) VALUES ('a', '1')").run();
  db.exec('ROLLBACK');
  assert.equal(db.isTransaction, false);
  assert.equal(db.prepare("SELECT value FROM bond_kv WHERE key = 'a'").get(), undefined);

  db.exec('BEGIN IMMEDIATE');
  const r = db.prepare("INSERT INTO bond_kv (key, value) VALUES ('b', '2')").run();
  assert.equal(Number(r.changes), 1);
  db.exec('COMMIT');
  assert.deepEqual({ ...(db.prepare("SELECT value FROM bond_kv WHERE key = 'b'").get() as object) }, { value: '2' });
});

test('adaptador: os repositórios do PC rodam iguais e a fila de envio é preenchida pelos gatilhos', async () => {
  const db = await open();
  migrate(asNode(db), MIGRATIONS);
  const tasks = new SqliteTaskRepository(asNode(db));
  const created = await tasks.create('Comprar leite', null, null, { priority: 2 });
  assert.ok(created.ok);
  const id = created.ok ? created.value.id : '';
  await tasks.update(id, { title: 'Comprar leite e pão' });
  await tasks.complete(id);
  const list = await tasks.list();
  assert.deepEqual(list.completed.map((t) => t.title), ['Comprar leite e pão']);

  const notes = new SqliteNotesRepository(asNode(db));
  const note = await notes.create({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'oi' }] }] } });
  assert.ok(note.ok);

  const store = new SyncStore(asNode(db));
  const pending = store.pending().map((p) => `${p.tbl}:${p.op}`).sort();
  assert.deepEqual(pending, ['notes:upsert', 'tasks:upsert']);
  const row = store.readRow('tasks', id);
  assert.equal(row?.origin, store.deviceId());
});

test('adaptador: exportar e reabrir preserva os dados; subtarefas e exclusão em cascata funcionam', async () => {
  const db = await open();
  migrate(asNode(db), MIGRATIONS);
  const tasks = new SqliteTaskRepository(asNode(db));
  const parent = await tasks.create('Mudança');
  const pid = parent.ok ? parent.value.id : '';
  await tasks.create('Caixas', null, null, { parentId: pid });
  const bytes = db.export();
  db.close();

  const again = await open(bytes);
  assert.equal(currentVersion(asNode(again)), MIGRATIONS.length);
  const repo = new SqliteTaskRepository(asNode(again));
  assert.equal((await repo.list()).active.length, 2);
  await repo.remove(pid);
  assert.equal((await repo.list()).active.length, 0);
  const tomb = again.prepare('SELECT COUNT(*) AS n FROM tombstones').get() as { n: number };
  assert.equal(Number(tomb.n), 2, 'principal e subtarefa deixam marca de exclusão');
});
