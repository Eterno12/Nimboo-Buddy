import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, openDatabaseDetailed } from '../electron/tasks/database.ts';
import { currentVersion, MIGRATIONS } from '../electron/tasks/migrations.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { SqliteNotesRepository } from '../electron/notes/sqliteNotesRepository.ts';
import { SyncStore } from '../electron/sync/syncStore.ts';
import { isNewer, type Stamp } from '../shared/sync/merge.ts';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimboo-sync-'));
  const file = path.join(dir, 'data', 'mochi.db');
  const db = openDatabase(file);
  let clock = new Date('2026-10-15T12:00:00.000Z');
  const tick = (ms = 1000) => (clock = new Date(clock.getTime() + ms));
  const tasks = new SqliteTaskRepository(db, { now: () => clock });
  return { dir, file, db, tasks, tick, now: () => clock, done: () => (db.close(), fs.rmSync(dir, { recursive: true, force: true })) };
}

const outbox = (db: DatabaseSync) =>
  (db.prepare('SELECT tbl, id, op FROM outbox ORDER BY seq').all() as unknown as { tbl: string; id: string; op: string }[]).map((r) => ({ ...r }));

test('merge: vence a edição mais nova; empate decide pelo aparelho, sempre igual nos dois lados', () => {
  const a: Stamp = { updatedAt: '2026-10-15T10:00:00.000Z', origin: 'aaa' };
  const b: Stamp = { updatedAt: '2026-10-15T10:00:01.000Z', origin: 'bbb' };
  assert.equal(isNewer(b, a), true);
  assert.equal(isNewer(a, b), false);
  const tie: Stamp = { updatedAt: a.updatedAt, origin: 'zzz' };
  assert.equal(isNewer(tie, a), true);
  assert.equal(isNewer(a, tie), false);
  assert.equal(isNewer(a, a), false, 'igual não substitui');
});

test('migração v9: cria fila, marcas e identidade do aparelho sem perder tarefas', () => {
  const t = setup();
  try {
    assert.equal(currentVersion(t.db), MIGRATIONS.length);
    assert.ok(MIGRATIONS.length >= 9);
    for (const name of ['outbox', 'tombstones', 'sync_meta', 'sync_ctx']) {
      assert.ok(t.db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(name), name);
    }
    const id = t.db.prepare("SELECT value FROM sync_meta WHERE key = 'device_id'").get() as { value: string };
    assert.match(id.value, /^[0-9a-f]{32}$/);
  } finally {
    t.done();
  }
});

test('mudança local entra na fila na mesma transação e marca o aparelho de origem', async () => {
  const t = setup();
  try {
    const r = await t.tasks.create('Beber água');
    assert.ok(r.ok);
    const id = r.ok ? r.value.id : '';
    assert.deepEqual(outbox(t.db), [{ tbl: 'tasks', id, op: 'upsert' }]);
    const device = (t.db.prepare("SELECT value FROM sync_meta WHERE key = 'device_id'").get() as { value: string }).value;
    const row = t.db.prepare('SELECT origin FROM tasks WHERE id = ?').get(id) as { origin: string };
    assert.equal(row.origin, device);

    t.tick();
    await t.tasks.update(id, { title: 'Beber mais água' });
    const store = new SyncStore(t.db);
    assert.deepEqual(store.pending().map((p) => ({ ...p })), [{ seq: 2, tbl: 'tasks', id, op: 'upsert' }], 'compacta: um item por registro');
  } finally {
    t.done();
  }
});

test('excluir vira marca de exclusão (com as subtarefas); a limpeza dos 30 dias NÃO propaga', async () => {
  const t = setup();
  try {
    const parent = await t.tasks.create('Mudança');
    const pid = parent.ok ? parent.value.id : '';
    const sub = await t.tasks.create('Caixas', null, null, { parentId: pid });
    const sid = sub.ok ? sub.value.id : '';
    const old = await t.tasks.create('Antiga');
    const oid = old.ok ? old.value.id : '';
    await t.tasks.complete(oid);
    t.db.prepare('DELETE FROM outbox').run();

    await t.tasks.remove(pid);
    const ops = outbox(t.db).filter((o) => o.op === 'delete').map((o) => o.id).sort();
    assert.deepEqual(ops, [pid, sid].sort());
    const tomb = t.db.prepare('SELECT id FROM tombstones ORDER BY id').all() as { id: string }[];
    assert.deepEqual(tomb.map((x) => x.id).sort(), [pid, sid].sort());

    t.db.prepare('DELETE FROM outbox').run();
    t.tick(31 * 24 * 3600 * 1000);
    assert.equal(t.tasks.purgeExpired(), 1);
    assert.deepEqual(outbox(t.db), [], 'limpeza local não vira exclusão do usuário');
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM tombstones WHERE id = ?').get(oid) as { n: number }).n, 0);
  } finally {
    t.done();
  }
});

test('notas: criar, editar e excluir também entram na fila', async () => {
  const t = setup();
  try {
    const notes = new SqliteNotesRepository(t.db, { now: t.now });
    const created = await notes.create({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'oi' }] }] } });
    assert.ok(created.ok);
    const id = created.ok ? created.value.id : '';
    await notes.remove(id);
    assert.deepEqual(outbox(t.db).map((o) => `${o.tbl}:${o.op}`), ['notes:upsert', 'notes:delete']);
  } finally {
    t.done();
  }
});

test('aplicar o que veio da nuvem: mais novo substitui, mais antigo é ignorado, nada volta para a fila', async () => {
  const t = setup();
  try {
    const store = new SyncStore(t.db);
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Veio do celular',
      completed: 0,
      created_at: '2026-10-15T09:00:00.000Z',
      completed_at: null,
      updated_at: '2026-10-15T09:00:00.000Z',
      due_at: null,
      source_ref: null,
      priority: 0,
      recurrence: null,
      parent_id: null,
      position: null,
      origin: 'phone',
    };
    assert.equal(store.applyUpsert('tasks', base), 'applied');
    assert.equal(outbox(t.db).length, 0);
    assert.equal((await t.tasks.get(base.id)).ok, true);

    assert.equal(store.applyUpsert('tasks', { ...base, title: 'Antigo', updated_at: '2026-10-15T08:00:00.000Z' }), 'ignored');
    const keep = await t.tasks.get(base.id);
    assert.equal(keep.ok && keep.value.title, 'Veio do celular');

    assert.equal(store.applyUpsert('tasks', { ...base, title: 'Novo', updated_at: '2026-10-15T10:00:00.000Z' }), 'applied');
    const newer = await t.tasks.get(base.id);
    assert.equal(newer.ok && newer.value.title, 'Novo');
    assert.equal(outbox(t.db).length, 0);
  } finally {
    t.done();
  }
});

test('exclusão feita aqui não ressuscita com uma cópia mais antiga vinda da nuvem; exclusão remota apaga sem eco', async () => {
  const t = setup();
  try {
    const store = new SyncStore(t.db);
    const created = await t.tasks.create('Apagar');
    const id = created.ok ? created.value.id : '';
    const stale = t.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>;
    t.tick();
    await t.tasks.remove(id);
    t.db.prepare('DELETE FROM outbox').run();
    assert.equal(store.applyUpsert('tasks', { ...stale, origin: 'phone' }), 'ignored', 'ressurreição bloqueada');
    assert.equal((await t.tasks.get(id)).ok, false);

    const other = await t.tasks.create('Outra');
    const oid = other.ok ? other.value.id : '';
    t.db.prepare('DELETE FROM outbox').run();
    t.tick();
    assert.equal(store.applyDelete('tasks', oid, t.now().toISOString(), 'phone'), 'applied');
    assert.equal((await t.tasks.get(oid)).ok, false);
    assert.equal(outbox(t.db).length, 0, 'exclusão vinda da nuvem não volta para a nuvem');
  } finally {
    t.done();
  }
});

test('enviar e confirmar: a confirmação só remove o que foi enviado', async () => {
  const t = setup();
  try {
    const store = new SyncStore(t.db);
    await t.tasks.create('A');
    const first = store.pending();
    await t.tasks.create('B');
    store.ack(first.at(-1)!.seq);
    assert.equal(store.pending().length, 1, 'o item novo continua pendente');
  } finally {
    t.done();
  }
});

test('banco recuperado de corrupção exige baixar tudo antes de enviar qualquer coisa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimboo-sync-corrupt-'));
  try {
    const file = path.join(dir, 'mochi.db');
    fs.writeFileSync(file, 'isto não é um banco sqlite, é lixo '.repeat(50));
    const opened = openDatabaseDetailed(file);
    assert.ok(opened.recoveredFrom);
    const store = new SyncStore(opened.db);
    assert.equal(store.needsFullPull(), true);
    store.markFullPullDone();
    assert.equal(store.needsFullPull(), false);
    opened.db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('atualizar um banco v8 com dados: nada se perde, ganha identidade e a 1ª sincronização enfileira tudo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimboo-sync-v8-'));
  try {
    const file = path.join(dir, 'mochi.db');
    const old = openDatabase(file, { migrations: MIGRATIONS.slice(0, 8) });
    old.prepare("INSERT INTO tasks (id, title, completed, created_at, updated_at) VALUES ('22222222-2222-4222-8222-222222222222', 'Antiga', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')").run();
    assert.equal(currentVersion(old), 8);
    old.close();

    const db = openDatabase(file);
    assert.equal(currentVersion(db), MIGRATIONS.length);
    const row = db.prepare('SELECT title, origin FROM tasks').get() as { title: string; origin: string | null };
    assert.equal(row.title, 'Antiga');
    assert.equal(outbox(db).length, 0, 'dados antigos não entram na fila sozinhos');
    const store = new SyncStore(db);
    assert.equal(store.enqueueAll(), 1);
    assert.deepEqual(outbox(db), [{ tbl: 'tasks', id: '22222222-2222-4222-8222-222222222222', op: 'upsert' }]);
    const payload = store.readRow('tasks', '22222222-2222-4222-8222-222222222222');
    assert.equal(payload?.origin, store.deviceId(), 'registro antigo sai com o aparelho de origem preenchido');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
