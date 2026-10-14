import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { currentVersion, MIGRATIONS } from '../electron/tasks/migrations.ts';
import { SqliteBondStore } from '../electron/bond/bondStore.ts';
import { BondEngine } from '../electron/bond/bondEngine.ts';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-bond-'));
  const file = path.join(dir, 'data', 'mochi.db');
  const db = openDatabase(file);
  let clock = new Date(2026, 9, 14, 12, 0);
  const unlocked: string[][] = [];
  const make = () =>
    new BondEngine({
      store: new SqliteBondStore(db),
      now: () => clock,
      onUnlocked: (ids) => unlocked.push(ids),
    });
  return {
    db,
    file,
    make,
    unlocked,
    setClock: (d: Date) => (clock = d),
    done: () => (db.close(), fs.rmSync(dir, { recursive: true, force: true })),
  };
}

test('migração v7: tabelas do vínculo existem num banco novo', () => {
  const t = setup();
  try {
    assert.equal(currentVersion(t.db), MIGRATIONS.length);
    for (const name of ['bond_kv', 'achievements']) {
      assert.ok(t.db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(name), name);
    }
  } finally {
    t.done();
  }
});

test('motor: eventos viram contadores, desbloqueiam conquistas e persistem entre reinícios', () => {
  const t = setup();
  try {
    const a = t.make();
    a.handle({ type: 'open' });
    assert.deepEqual(a.handle({ type: 'task_completed' }), ['first_task']);
    assert.deepEqual(t.unlocked, [['first_task']]);
    a.saveAffection(0.83);
    assert.deepEqual(a.handle({ type: 'task_completed' }), [], 'não desbloqueia de novo');

    // "reinicia": novo motor sobre o mesmo banco
    const b = t.make();
    const snap = b.snapshot();
    assert.equal(snap.stats.tasks_completed, 2);
    assert.equal(snap.affection, 0.83);
    assert.equal(snap.unlockedCount, 1);
    assert.equal(snap.achievements.find((x) => x.id === 'first_task')?.unlocked, true);
    assert.deepEqual(b.handle({ type: 'task_completed' }), [], 'continua sem repetir depois de reiniciar');
    assert.equal(b.snapshot().stats.tasks_completed, 3);
  } finally {
    t.done();
  }
});

test('motor: dias seguidos entre reinícios e conquista de sequência', () => {
  const t = setup();
  try {
    for (const day of [14, 15, 16]) {
      t.setClock(new Date(2026, 9, day, 10, 0));
      t.make().handle({ type: 'open' });
    }
    const snap = t.make().snapshot();
    assert.deepEqual([snap.stats.days_total, snap.stats.streak], [3, 3]);
    assert.equal(snap.achievements.find((x) => x.id === 'streak_3')?.unlocked, true);
    assert.equal(snap.days.firstDay, '2026-10-14');
  } finally {
    t.done();
  }
});

test('motor: eventos da interface só aceitam os tipos permitidos; afeto é limitado a 0..1', () => {
  const t = setup();
  try {
    const e = t.make();
    assert.equal(e.handleFromRenderer({ type: 'pet' }), true);
    for (const bad of [{ type: 'task_completed' }, { type: 'character', id: 'x' }, { type: 42 }, null, 'pet', []]) {
      assert.equal(e.handleFromRenderer(bad), false, JSON.stringify(bad));
    }
    assert.equal(e.snapshot().stats.pets, 1);
    e.saveAffection(7);
    assert.equal(e.snapshot().affection, 1);
    e.saveAffection(-3);
    assert.equal(e.snapshot().affection, 0);
    e.saveAffection('muito');
    assert.equal(e.snapshot().affection, 0, 'valor inválido é ignorado');
  } finally {
    t.done();
  }
});

test('armazenamento: dados corrompidos viram estado vazio em vez de quebrar', () => {
  const t = setup();
  try {
    t.db.prepare("INSERT INTO bond_kv (key, value) VALUES ('stats', '{nao json'), ('days', '[]'), ('affection', 'abc')").run();
    const snap = t.make().snapshot();
    assert.deepEqual(snap.stats, {});
    assert.equal(snap.affection, 0.5);
    assert.deepEqual(snap.days.characters, []);
  } finally {
    t.done();
  }
});
