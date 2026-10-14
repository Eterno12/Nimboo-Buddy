import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { currentVersion, MIGRATIONS } from '../electron/tasks/migrations.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { RemovalScheduler } from '../electron/tasks/removalScheduler.ts';
import { SUBTASK_LIMIT, nextDue, type TaskChange } from '../shared/tasks.ts';

function setup(startIso = '2026-10-14T10:00:00.000Z') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-tc-'));
  const db = openDatabase(path.join(dir, 'data', 'mochi.db'));
  let n = 0;
  let t = new Date(startIso).getTime();
  const events: TaskChange[] = [];
  const repo = new SqliteTaskRepository(db, {
    now: () => new Date(t),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    onChange: (e) => events.push(e),
  });
  return {
    db,
    repo,
    events,
    set: (iso: string) => (t = new Date(iso).getTime()),
    done: () => (db.close(), fs.rmSync(dir, { recursive: true, force: true })),
  };
}

const local = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

test('nextDue: diário, dias úteis (sexta → segunda), semanal e mensal com fim de mês', () => {
  const past = new Date(2026, 0, 1);
  assert.equal(nextDue(local(2026, 10, 14, 9, 30), 'daily', past), local(2026, 10, 15, 9, 30));
  // 16/10/2026 é sexta-feira: o próximo dia útil é segunda 19
  assert.equal(nextDue(local(2026, 10, 16, 8), 'weekdays', past), local(2026, 10, 19, 8));
  assert.equal(nextDue(local(2026, 10, 14, 18), 'weekly', past), local(2026, 10, 21, 18));
  assert.equal(nextDue(local(2026, 1, 31, 10), 'monthly', past), local(2026, 2, 28, 10), 'fevereiro tem 28');
  assert.equal(nextDue(local(2026, 12, 15, 10), 'monthly', past), local(2027, 1, 15, 10), 'vira o ano');
});

test('nextDue: nunca devolve uma data no passado (app fechado por dias)', () => {
  const now = new Date(2026, 9, 20, 12, 0); // 20/10 12:00
  assert.equal(nextDue(local(2026, 10, 14, 9), 'daily', now), local(2026, 10, 21, 9));
  assert.equal(nextDue(local(2026, 10, 14, 9), 'weekly', now), local(2026, 10, 21, 9));
  assert.equal(nextDue(local(2026, 8, 5, 9), 'monthly', now), local(2026, 11, 5, 9));
  // mesmo dia, hora ainda por vir
  assert.equal(nextDue(local(2026, 10, 19, 15), 'daily', now), local(2026, 10, 20, 15));
});

test('editar: título, prioridade e repetição; entradas inválidas são recusadas', async () => {
  const t = setup();
  try {
    const a = await t.repo.create('Antes');
    assert.ok(a.ok);
    if (!a.ok) return;
    const r = await t.repo.update(a.value.id, { title: '  Depois  ', priority: 3, recurrence: 'weekly' });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual([r.value.title, r.value.priority, r.value.recurrence], ['Depois', 3, 'weekly']);
    assert.equal(t.events.at(-1)?.type, 'updated');
    const clear = await t.repo.update(a.value.id, { recurrence: null });
    assert.ok(clear.ok && clear.value.recurrence === null);
    for (const bad of [{ title: '' }, { title: 'x'.repeat(201) }, { priority: 7 }, { priority: '2' }, { recurrence: 'hourly' }]) {
      const e = await t.repo.update(a.value.id, bad as never);
      assert.equal(e.ok, false, JSON.stringify(bad));
    }
    assert.equal((await t.repo.update('nao-e-id', { title: 'x' })).ok, false);
    const after = await t.repo.get(a.value.id);
    assert.ok(after.ok && after.value.title === 'Depois' && after.value.priority === 3, 'as recusas não alteram nada');
  } finally {
    t.done();
  }
});

test('subtarefas: várias por tarefa, um nível só, limite e regras da principal', async () => {
  const t = setup();
  try {
    const p = await t.repo.create('Viagem');
    assert.ok(p.ok);
    if (!p.ok) return;
    for (const title of ['Passagens', 'Hotel', 'Malas']) {
      const s = await t.repo.create(title, null, null, { parentId: p.value.id });
      assert.ok(s.ok && s.value.parentId === p.value.id, title);
    }
    const lists = await t.repo.list();
    assert.equal(lists.active.filter((x) => x.parentId === p.value.id).length, 3);

    const sub = lists.active.find((x) => x.title === 'Hotel')!;
    const nested = await t.repo.create('Quarto', null, null, { parentId: sub.id });
    assert.equal(nested.ok, false, 'subtarefa de subtarefa');
    const orphan = await t.repo.create('Solta', null, null, { parentId: '99999999-9999-4999-8999-999999999999' });
    assert.equal(orphan.ok, false);
    const withRec = await t.repo.create('Sub repetida', null, null, { parentId: p.value.id, recurrence: 'daily' });
    assert.ok(withRec.ok && withRec.value.recurrence === null, 'subtarefa não repete');

    for (let i = 0; i < SUBTASK_LIMIT; i++) await t.repo.create(`s${i}`, null, null, { parentId: p.value.id });
    const over = await t.repo.create('demais', null, null, { parentId: p.value.id });
    assert.equal(over.ok, false);
    if (!over.ok) assert.equal(over.error.code, 'limit_reached');
  } finally {
    t.done();
  }
});

test('concluir a principal conclui as subtarefas; excluir a principal apaga as subtarefas', async () => {
  const t = setup();
  try {
    const p = await t.repo.create('Mudança');
    const c = await t.repo.create('Caixas', null, null, { parentId: p.ok ? p.value.id : '' });
    assert.ok(p.ok && c.ok);
    if (!p.ok || !c.ok) return;
    assert.ok((await t.repo.complete(p.value.id)).ok);
    let lists = await t.repo.list();
    assert.equal(lists.active.length, 0);
    assert.equal(lists.completed.length, 2);
    assert.ok((await t.repo.remove(p.value.id)).ok);
    lists = await t.repo.list();
    assert.equal(lists.completed.length, 0, 'a subtarefa foi junto');
    assert.equal((await t.repo.get(c.value.id)).ok, false);
  } finally {
    t.done();
  }
});

test('repetição: concluir cria a próxima ocorrência (prazo seguinte, subtarefas zeradas, sem origem)', async () => {
  const t = setup('2026-10-14T10:00:00.000Z');
  try {
    const due = local(2026, 10, 14, 18, 0);
    const p = await t.repo.create('Regar as plantas', due, 'evento-x', { recurrence: 'daily', priority: 2 });
    assert.ok(p.ok);
    if (!p.ok) return;
    await t.repo.create('Samambaia', null, null, { parentId: p.value.id });
    t.events.length = 0;
    assert.ok((await t.repo.complete(p.value.id)).ok);

    const lists = await t.repo.list();
    assert.equal(lists.completed.length, 2, 'principal + subtarefa concluídas');
    const next = lists.active.find((x) => x.parentId === null)!;
    assert.equal(next.title, 'Regar as plantas');
    assert.equal(next.dueAt, local(2026, 10, 15, 18, 0));
    assert.equal(next.recurrence, 'daily');
    assert.equal(next.priority, 2);
    assert.equal(next.sourceRef, null);
    const subs = lists.active.filter((x) => x.parentId === next.id);
    assert.deepEqual(subs.map((s) => [s.title, s.completed]), [['Samambaia', false]]);
    assert.deepEqual(t.events.map((e) => e.type), ['completed', 'created']);

    // sem repetição ou sem prazo: nada nasce
    const plain = await t.repo.create('Única', due);
    const noDue = await t.repo.create('Sem prazo', null, null, { recurrence: 'weekly' });
    assert.ok(plain.ok && noDue.ok);
    if (plain.ok) await t.repo.complete(plain.value.id);
    if (noDue.ok) await t.repo.complete(noDue.value.id);
    assert.equal((await t.repo.list()).active.filter((x) => x.parentId === null).length, 1);
  } finally {
    t.done();
  }
});

test('ordem manual: reordenar muda a lista e novas tarefas vão para o fim', async () => {
  const t = setup();
  try {
    const ids: string[] = [];
    for (const title of ['A', 'B', 'C']) {
      const r = await t.repo.create(title);
      if (r.ok) ids.push(r.value.id);
    }
    assert.deepEqual((await t.repo.list()).active.map((x) => x.title), ['A', 'B', 'C']);
    assert.ok((await t.repo.reorder([ids[2], ids[0], ids[1]])).ok);
    assert.deepEqual((await t.repo.list()).active.map((x) => x.title), ['C', 'A', 'B']);
    await t.repo.create('D');
    assert.deepEqual((await t.repo.list()).active.map((x) => x.title), ['C', 'A', 'B', 'D']);
    for (const bad of [['nao-id'], [ids[0], ids[0]], 'x' as unknown as string[]]) {
      assert.equal((await t.repo.reorder(bad)).ok, false);
    }
  } finally {
    t.done();
  }
});

test('exclusão com desfazer esconde as subtarefas junto', async () => {
  const t = setup();
  try {
    const p = await t.repo.create('Projeto');
    assert.ok(p.ok);
    if (!p.ok) return;
    await t.repo.create('Etapa 1', null, null, { parentId: p.value.id });
    const timers: (() => void)[] = [];
    const scheduler = new RemovalScheduler(t.repo, { setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => {} });
    await scheduler.schedule(p.value.id);
    const snap = scheduler.snapshot(await t.repo.list());
    assert.equal(snap.active.length, 0, 'principal e subtarefa somem');
    assert.equal(snap.pendingRemovals.length, 1);
    const undo = await scheduler.undo(p.value.id);
    assert.ok(undo.ok);
    assert.equal(scheduler.snapshot(await t.repo.list()).active.length, 2);
  } finally {
    t.done();
  }
});

test('migração v5: bancos v4 ganham as colunas sem perder tarefas, prazos nem origem', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-v5-'));
  const file = path.join(dir, 'mochi.db');
  try {
    const v4 = openDatabase(file, { migrations: MIGRATIONS.slice(0, 4) });
    v4.prepare(
      "INSERT INTO tasks (id, title, completed, created_at, completed_at, updated_at, due_at, source_ref) VALUES ('55555555-5555-4555-8555-555555555555', 'antiga', 0, '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', '2026-12-01T10:00:00.000Z', 'ev|1')",
    ).run();
    v4.close();
    const db = openDatabase(file);
    try {
      assert.equal(currentVersion(db), MIGRATIONS.length);
      const list = await new SqliteTaskRepository(db).list();
      assert.equal(list.active.length, 1);
      const [task] = list.active;
      assert.deepEqual(
        [task.dueAt, task.sourceRef, task.priority, task.recurrence, task.parentId, task.position],
        ['2026-12-01T10:00:00.000Z', 'ev|1', 0, null, null, null],
      );
    } finally {
      db.close();
    }
    assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('mochi.db.bak-v4-')), 'backup antes de migrar');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
