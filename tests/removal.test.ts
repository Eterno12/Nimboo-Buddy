import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { RemovalScheduler } from '../electron/tasks/removalScheduler.ts';
import { UNDO_WINDOW_MS, type TaskChange } from '../shared/tasks.ts';

const DAY = 24 * 60 * 60 * 1000;

/** Ambiente isolado: banco temporário, relógio e temporizadores controlados. */
function setup(start = '2026-01-01T00:00:00.000Z') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-removal-'));
  const db = openDatabase(path.join(dir, 'mochi.db'));
  let t = new Date(start).getTime();
  const now = () => new Date(t);
  const events: TaskChange[] = [];
  let n = 0;
  const repo = new SqliteTaskRepository(db, {
    now,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    onChange: (e) => events.push(e),
  });
  // Temporizadores manuais: nada dispara sozinho.
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let changes = 0;
  const scheduler = new RemovalScheduler(repo, {
    now,
    setTimer: (fn) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    onChange: () => changes++,
  });
  return {
    db,
    repo,
    scheduler,
    events,
    timers,
    changes: () => changes,
    advance: (ms: number) => (t += ms),
    /** Dispara os temporizadores pendentes e espera as promessas assentarem. */
    async fireAll() {
      const fns = [...timers.values()];
      timers.clear();
      for (const fn of fns) fn();
      await new Promise((r) => setImmediate(r));
    },
    count: () => (db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n,
    cleanup() {
      scheduler.dispose();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('agendar: a tarefa some das listas mas NÃO é apagada antes do prazo', async () => {
  const t = setup();
  try {
    const a = await t.repo.create('manter');
    const b = await t.repo.create('excluir');
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;

    const r = await t.scheduler.schedule(b.value.id);
    assert.ok(r.ok);
    if (r.ok) {
      const expected = new Date(new Date('2026-01-01T00:00:00.000Z').getTime() + UNDO_WINDOW_MS).toISOString();
      assert.equal(r.value.expiresAt, expected);
    }

    const snap = t.scheduler.snapshot(await t.repo.list());
    assert.deepEqual(snap.active.map((x) => x.title), ['manter']);
    assert.deepEqual(snap.pendingRemovals.map((p) => p.task.title), ['excluir']);
    assert.equal(t.count(), 2, 'o banco ainda tem as duas tarefas');
    assert.ok(!t.events.some((e) => e.type === 'removed'));
  } finally {
    t.cleanup();
  }
});

test('prazo termina: a exclusão vira definitiva uma única vez', async () => {
  const t = setup();
  try {
    const b = await t.repo.create('excluir');
    assert.ok(b.ok);
    if (!b.ok) return;
    await t.scheduler.schedule(b.value.id);
    await t.fireAll();
    assert.equal(t.count(), 0);
    assert.deepEqual(t.events.filter((e) => e.type === 'removed'), [{ type: 'removed', id: b.value.id }]);
    const snap = t.scheduler.snapshot(await t.repo.list());
    assert.equal(snap.pendingRemovals.length, 0);
    // Depois do prazo, desfazer já não é possível.
    const late = await t.scheduler.undo(b.value.id);
    assert.ok(!late.ok && late.error.code === 'not_found');
  } finally {
    t.cleanup();
  }
});

test('desfazer: cancela a exclusão sem perda de dados e o prazo não apaga mais', async () => {
  const t = setup();
  try {
    const b = await t.repo.create('talvez');
    assert.ok(b.ok);
    if (!b.ok) return;
    await t.repo.complete(b.value.id);
    const before = (await t.repo.get(b.value.id)) as { ok: true; value: { updatedAt: string; completedAt: string } };

    await t.scheduler.schedule(b.value.id);
    const undone = await t.scheduler.undo(b.value.id);
    assert.ok(undone.ok);
    if (undone.ok) assert.deepEqual(undone.value, before.value, 'a tarefa volta idêntica (id, datas, estado)');

    await t.fireAll(); // nenhum temporizador restou
    assert.equal(t.count(), 1);
    const snap = t.scheduler.snapshot(await t.repo.list());
    assert.deepEqual(snap.completed.map((x) => x.id), [b.value.id]);
    assert.equal(snap.pendingRemovals.length, 0);
  } finally {
    t.cleanup();
  }
});

test('desfazer NÃO restaura tarefa concluída que a retenção de 30 dias removeu', async () => {
  const t = setup('2026-03-01T00:00:00.000Z');
  try {
    const b = await t.repo.create('antiga');
    assert.ok(b.ok);
    if (!b.ok) return;
    await t.repo.complete(b.value.id);
    t.advance(30 * DAY - 2000); // faltam 2 s para completar 30 dias
    await t.scheduler.schedule(b.value.id);

    t.advance(3000); // o prazo de 30 dias passou durante a janela de 5 s
    const undone = await t.scheduler.undo(b.value.id);
    assert.ok(!undone.ok);
    if (!undone.ok) assert.equal(undone.error.code, 'not_found');
    assert.equal(t.count(), 0, 'continua apagada (não ressuscita)');
  } finally {
    t.cleanup();
  }
});

test('retenção durante o prazo: o snapshot descarta a entrada sem erro', async () => {
  const t = setup('2026-03-01T00:00:00.000Z');
  try {
    const b = await t.repo.create('antiga');
    assert.ok(b.ok);
    if (!b.ok) return;
    await t.repo.complete(b.value.id);
    t.advance(30 * DAY - 1000);
    await t.scheduler.schedule(b.value.id);
    t.advance(2000);
    const snap = t.scheduler.snapshot(await t.repo.list()); // list() aplica a retenção
    assert.equal(snap.pendingRemovals.length, 0);
    assert.equal(t.scheduler.isPending(b.value.id), false);
    assert.equal(t.timers.size, 0, 'o temporizador também foi cancelado');
  } finally {
    t.cleanup();
  }
});

test('duplicatas e concorrência: agendar duas vezes cria um só prazo; várias tarefas são independentes', async () => {
  const t = setup();
  try {
    const ids: string[] = [];
    for (const title of ['a', 'b', 'c']) {
      const r = await t.repo.create(title);
      assert.ok(r.ok);
      if (r.ok) ids.push(r.value.id);
    }
    // Chamadas simultâneas para a mesma tarefa.
    const both = await Promise.all([t.scheduler.schedule(ids[0]), t.scheduler.schedule(ids[0])]);
    assert.ok(both.every((r) => r.ok));
    assert.equal(t.timers.size, 1, 'um único temporizador para a mesma tarefa');

    await t.scheduler.schedule(ids[1]);
    assert.equal(t.timers.size, 2);

    // Desfazer uma não afeta a outra.
    await t.scheduler.undo(ids[0]);
    await t.fireAll();
    assert.equal(t.count(), 2);
    const left = (await t.repo.list()).active.map((x) => x.title).sort();
    assert.deepEqual(left, ['a', 'c']);
  } finally {
    t.cleanup();
  }
});

test('corrida entre desfazer e o fim do prazo: nunca apaga uma tarefa desfeita', async () => {
  const t = setup();
  try {
    const b = await t.repo.create('corrida');
    assert.ok(b.ok);
    if (!b.ok) return;
    await t.scheduler.schedule(b.value.id);
    const fire = [...t.timers.values()][0];
    const pendingUndo = t.scheduler.undo(b.value.id); // cancela o temporizador de imediato
    fire(); // o temporizador "disparou" no mesmo instante
    const undone = await pendingUndo;
    await new Promise((r) => setImmediate(r));
    assert.ok(undone.ok);
    assert.equal(t.count(), 1);
  } finally {
    t.cleanup();
  }
});

test('encerrar o app durante o prazo cancela as exclusões: as tarefas ficam', async () => {
  const t = setup();
  try {
    const b = await t.repo.create('fica');
    assert.ok(b.ok);
    if (!b.ok) return;
    await t.scheduler.schedule(b.value.id);
    t.scheduler.dispose(); // o que acontece ao fechar o app
    await t.fireAll();
    assert.equal(t.count(), 1);
    assert.equal(t.scheduler.isPending(b.value.id), false);
  } finally {
    t.cleanup();
  }
});

test('ids inválidos ou inexistentes', async () => {
  const t = setup();
  try {
    const bad = await t.scheduler.schedule('nao-e-uuid');
    assert.ok(!bad.ok && bad.error.code === 'invalid_id');
    const missing = await t.scheduler.schedule('00000000-0000-4000-8000-0000000000ff');
    assert.ok(!missing.ok && missing.error.code === 'not_found');
    const noUndo = await t.scheduler.undo('00000000-0000-4000-8000-0000000000ff');
    assert.ok(!noUndo.ok && noUndo.error.code === 'not_found');
    assert.equal(t.timers.size, 0);
  } finally {
    t.cleanup();
  }
});

test('notifica a cada mudança do conjunto de pendentes', async () => {
  const t = setup();
  try {
    const b = await t.repo.create('x');
    assert.ok(b.ok);
    if (!b.ok) return;
    await t.scheduler.schedule(b.value.id);
    assert.equal(t.changes(), 1);
    await t.scheduler.undo(b.value.id);
    assert.equal(t.changes(), 2);
  } finally {
    t.cleanup();
  }
});
