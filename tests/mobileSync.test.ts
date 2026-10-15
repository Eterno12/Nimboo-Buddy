import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../electron/tasks/database.ts';
import { migrate, MIGRATIONS } from '../electron/tasks/migrations.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { SqliteNotesRepository } from '../electron/notes/sqliteNotesRepository.ts';
import { SyncStore } from '../electron/sync/syncStore.ts';
import { SqlJsDatabase, type SqlJsModule } from '../mobile/db/sqlJsDatabase.ts';
import { syncOnce } from '../shared/sync/engine.ts';
import { FakeServer } from './helpers/fakeSyncServer.ts';

const initSqlJs = createRequire(import.meta.url)('sql.js') as () => Promise<SqlJsModule>;

/** "PC" (node:sqlite) e "celular" (sql.js) conversando pelo mesmo servidor falso. */
async function pair() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimboo-mobile-'));
  const pcDb = openDatabase(path.join(dir, 'mochi.db'));
  const SQL = await initSqlJs();
  const phoneDb = new SqlJsDatabase(SQL);
  migrate(phoneDb as unknown as DatabaseSync, MIGRATIONS);
  const asNode = phoneDb as unknown as DatabaseSync;
  return {
    pc: { tasks: new SqliteTaskRepository(pcDb), notes: new SqliteNotesRepository(pcDb), store: new SyncStore(pcDb) },
    phone: { tasks: new SqliteTaskRepository(asNode), notes: new SqliteNotesRepository(asNode), store: new SyncStore(asNode) },
    done: () => (pcDb.close(), phoneDb.close(), fs.rmSync(dir, { recursive: true, force: true })),
  };
}

const titles = async (repo: SqliteTaskRepository) => (await repo.list()).active.map((t) => t.title).sort();

test('PC e celular (sql.js) convergem: tarefas, notas, edição e exclusão', async () => {
  const server = new FakeServer();
  const { pc, phone, done } = await pair();
  try {
    await pc.tasks.create('Do PC');
    const note = await pc.notes.create({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ideia' }] }] } });
    assert.ok(note.ok);
    await syncOnce(pc.store, server.transport());

    const r = await syncOnce(phone.store, server.transport());
    assert.equal(r.applied, 2);
    assert.deepEqual(await titles(phone.tasks), ['Do PC']);
    assert.equal((await phone.notes.list()).length, 1);
    assert.equal(phone.store.pending().length, 0, 'sem eco');

    // O celular cria e edita; o PC recebe.
    const made = await phone.tasks.create('Do celular');
    const id = made.ok ? made.value.id : '';
    await new Promise((r2) => setTimeout(r2, 5));
    await phone.tasks.update(id, { title: 'Do celular (editada)' });
    await syncOnce(phone.store, server.transport());
    await syncOnce(pc.store, server.transport());
    assert.deepEqual(await titles(pc.tasks), ['Do PC', 'Do celular (editada)']);

    // O PC exclui; o celular recebe e não ressuscita.
    await pc.tasks.remove(id);
    await syncOnce(pc.store, server.transport());
    await syncOnce(phone.store, server.transport());
    await syncOnce(pc.store, server.transport());
    assert.deepEqual(await titles(phone.tasks), ['Do PC']);
    assert.deepEqual(await titles(pc.tasks), ['Do PC']);
  } finally {
    done();
  }
});

test('celular offline: as mudanças ficam na fila e sobem quando a rede volta', async () => {
  const server = new FakeServer();
  const { pc, phone, done } = await pair();
  try {
    await phone.tasks.create('Criada sem rede');
    server.failNext = 1;
    await assert.rejects(() => syncOnce(phone.store, server.transport()), /sem rede/);
    assert.equal(phone.store.pending().length, 1);
    await syncOnce(phone.store, server.transport());
    await syncOnce(pc.store, server.transport());
    assert.deepEqual(await titles(pc.tasks), ['Criada sem rede']);
  } finally {
    done();
  }
});
