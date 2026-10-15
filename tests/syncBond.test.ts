import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../electron/tasks/database.ts';
import { MIGRATIONS } from '../electron/tasks/migrations.ts';
import { BondEngine } from '../electron/bond/bondEngine.ts';
import { SqliteBondStore } from '../electron/bond/bondStore.ts';
import { SyncStore } from '../electron/sync/syncStore.ts';
import { syncOnce } from '../shared/sync/engine.ts';
import { FakeServer } from './helpers/fakeSyncServer.ts';

function device(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nimboo-bond-${name}-`));
  const db = openDatabase(path.join(dir, 'mochi.db'));
  const engine = new BondEngine({ store: new SqliteBondStore(db), now: () => new Date('2026-10-15T12:00:00.000Z') });
  return { dir, db, engine, store: new SyncStore(db), done: () => (db.close(), fs.rmSync(dir, { recursive: true, force: true })) };
}

const outbox = (db: DatabaseSync) =>
  (db.prepare('SELECT tbl, id, op FROM outbox ORDER BY seq').all() as unknown as { tbl: string; id: string; op: string }[]).map((r) => ({ ...r }));

test('migração v10: acessórios viram linhas, conquistas ganham origem e há uma tabela de perfil', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimboo-v10-'));
  try {
    const file = path.join(dir, 'mochi.db');
    const old = openDatabase(file, { migrations: MIGRATIONS.slice(0, 9) });
    old.prepare("INSERT INTO bond_kv (key, value) VALUES ('skins', '[\"mochi.laco\",\"cactus.escuros\"]')").run();
    old.prepare("INSERT INTO achievements (id, unlocked_at) VALUES ('first_task', '2026-10-01T10:00:00.000Z')").run();
    old.close();

    const db = openDatabase(file);
    const skins = db.prepare('SELECT id FROM skins_owned ORDER BY id').all() as unknown as { id: string }[];
    assert.deepEqual(skins.map((s) => s.id), ['cactus.escuros', 'mochi.laco']);
    const ach = db.prepare('SELECT id, unlocked_at FROM achievements').all() as unknown as { id: string; unlocked_at: string }[];
    assert.equal(ach.length, 1);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'profile'").get());
    const engine = new BondEngine({ store: new SqliteBondStore(db) });
    assert.deepEqual(engine.snapshot().ownedSkins.sort(), ['cactus.escuros', 'mochi.laco']);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('conquistar e comprar entram na fila de envio (e nada mais do vínculo)', () => {
  const a = device('a');
  try {
    for (let i = 0; i < 10; i++) a.engine.handle({ type: 'task_completed' });
    a.engine.buySkin('mochi.laco');
    const rows = outbox(a.db);
    assert.ok(rows.some((r) => r.tbl === 'achievements' && r.id === 'first_task' && r.op === 'upsert'));
    assert.ok(rows.some((r) => r.tbl === 'skins_owned' && r.id === 'mochi.laco' && r.op === 'upsert'));
    assert.ok(!rows.some((r) => r.tbl === 'bond_kv'), 'contadores ficam em cada aparelho');
  } finally {
    a.done();
  }
});

test('PC e celular chegam ao mesmo conjunto de conquistas, pontos e acessórios', async () => {
  const server = new FakeServer();
  const a = device('a');
  const b = device('b');
  try {
    a.engine.handle({ type: 'task_completed' });
    a.engine.handle({ type: 'note_created' });
    b.engine.handle({ type: 'focus_finished', minutes: 25 }); // outra conquista, só no B
    await syncOnce(a.store, server.transport());
    await syncOnce(b.store, server.transport());
    await syncOnce(a.store, server.transport());
    a.engine.reload();
    b.engine.reload();

    const idsA = a.engine.snapshot().achievements.filter((x) => x.unlocked).map((x) => x.id).sort();
    const idsB = b.engine.snapshot().achievements.filter((x) => x.unlocked).map((x) => x.id).sort();
    assert.deepEqual(idsA, idsB);
    assert.ok(idsA.includes('first_task') && idsA.includes('first_note') && idsA.includes('first_focus'));
    assert.equal(a.engine.snapshot().points, b.engine.snapshot().points);

    // Acessório comprado num aparelho aparece no outro e o saldo bate.
    const pts = a.engine.snapshot().points;
    assert.ok(pts >= 20, `pontos ${pts}`);
    assert.ok(a.engine.buySkin('mochi.laco'));
    await syncOnce(a.store, server.transport());
    await syncOnce(b.store, server.transport());
    b.engine.reload();
    assert.deepEqual(b.engine.snapshot().ownedSkins, ['mochi.laco']);
    assert.equal(b.engine.snapshot().balance, a.engine.snapshot().balance);
  } finally {
    a.done();
    b.done();
  }
});

test('perfil: a edição mais nova vence e não volta como eco', async () => {
  const server = new FakeServer();
  const a = device('a');
  const b = device('b');
  try {
    const write = (db: DatabaseSync, json: string, at: string) =>
      db.prepare("INSERT INTO profile (id, data, updated_at) VALUES ('main', ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").run(json, at);
    write(a.db, '{"character":"cactus"}', '2026-10-15T10:00:00.000Z');
    await syncOnce(a.store, server.transport());
    await syncOnce(b.store, server.transport());
    const row = b.db.prepare("SELECT data FROM profile WHERE id = 'main'").get() as { data: string };
    assert.equal(row.data, '{"character":"cactus"}');
    assert.equal(b.store.pending().length, 0, 'sem eco');

    write(b.db, '{"character":"ghost"}', '2026-10-15T11:00:00.000Z');
    await syncOnce(b.store, server.transport());
    await syncOnce(a.store, server.transport());
    assert.equal((a.db.prepare("SELECT data FROM profile WHERE id = 'main'").get() as { data: string }).data, '{"character":"ghost"}');
  } finally {
    a.done();
    b.done();
  }
});
