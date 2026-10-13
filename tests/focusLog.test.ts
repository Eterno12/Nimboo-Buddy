import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { FocusLog, FOCUS_LOG_RETENTION_DAYS } from '../electron/focus/focusLog.ts';
import { validateDue, dueStatus } from '../shared/tasks.ts';

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-focuslog-'));
  const file = path.join(dir, 'data', 'mochi.db');
  const db = openDatabase(file);
  return { db, file, close: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('estatística do dia: só focos concluídos hoje (pausas e dias anteriores ficam de fora)', () => {
  const t = tmp();
  try {
    const log = new FocusLog(t.db);
    const noon = new Date(2026, 5, 10, 12, 0, 0);
    log.record({ kind: 'focus', minutes: 25, taskId: null, at: new Date(2026, 5, 10, 9, 30) });
    log.record({ kind: 'focus', minutes: 50, taskId: null, at: new Date(2026, 5, 10, 11, 0) });
    log.record({ kind: 'break', minutes: 5, taskId: null, at: new Date(2026, 5, 10, 11, 5) });
    log.record({ kind: 'focus', minutes: 25, taskId: null, at: new Date(2026, 5, 9, 23, 59) }); // ontem
    log.record({ kind: 'focus', minutes: 25, taskId: null, at: new Date(2026, 5, 11, 0, 0, 1) }); // amanhã
    assert.deepEqual(log.today(noon), { sessions: 2, minutes: 75 });
    assert.deepEqual(log.today(new Date(2026, 5, 9, 12)), { sessions: 1, minutes: 25 });
    assert.deepEqual(log.today(new Date(2026, 0, 1)), { sessions: 0, minutes: 0 });
  } finally {
    t.close();
  }
});

test('registro recusa minutos inválidos e limpa o que passou da retenção', () => {
  const t = tmp();
  try {
    const log = new FocusLog(t.db);
    log.record({ kind: 'focus', minutes: 0, taskId: null, at: new Date() });
    log.record({ kind: 'focus', minutes: 2.5, taskId: null, at: new Date() });
    assert.deepEqual(log.today(), { sessions: 0, minutes: 0 });
    const now = new Date(2027, 0, 1);
    log.record({ kind: 'focus', minutes: 10, taskId: null, at: new Date(now.getTime() - (FOCUS_LOG_RETENTION_DAYS + 5) * 86_400_000) });
    log.record({ kind: 'focus', minutes: 10, taskId: null, at: new Date(now.getTime() - 86_400_000) });
    assert.equal(log.purge(now), 1);
  } finally {
    t.close();
  }
});

test('migração v2: bancos v1 ganham due_at e focus_sessions sem perder tarefas', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-v2-'));
  const file = path.join(dir, 'mochi.db');
  try {
    const { MIGRATIONS } = await import('../electron/tasks/migrations.ts');
    const v1 = openDatabase(file, { migrations: MIGRATIONS.slice(0, 1) });
    v1.prepare(
      `INSERT INTO tasks (id, title, completed, created_at, completed_at, updated_at)
       VALUES ('22222222-2222-4222-8222-222222222222', 'antiga', 0, '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z')`,
    ).run();
    v1.close();
    const db = openDatabase(file);
    try {
      assert.equal((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 2);
      const repo = new SqliteTaskRepository(db);
      const list = await repo.list();
      assert.equal(list.active.length, 1);
      assert.equal(list.active[0].title, 'antiga');
      assert.equal(list.active[0].dueAt, null);
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'focus_sessions'").get());
    } finally {
      db.close();
    }
    assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('mochi.db.bak-v1-')), 'backup antes de migrar');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prazo: validação canônica, criação, alteração, remoção e ordenação por data', async () => {
  const t = tmp();
  try {
    const repo = new SqliteTaskRepository(t.db);
    assert.deepEqual(validateDue(null), { ok: true, value: null });
    assert.deepEqual(validateDue('2026-06-10T15:00:00Z'), { ok: true, value: '2026-06-10T15:00:00.000Z' });
    for (const bad of ['amanhã', '1999-01-01T00:00:00Z', '2200-01-01T00:00:00Z', 5, {}, 'x'.repeat(50)]) {
      const r = validateDue(bad);
      assert.ok(!r.ok && r.error.code === 'invalid_due', String(bad));
    }
    const noDue = await repo.create('sem prazo');
    const later = await repo.create('depois', '2026-06-12T10:00:00Z');
    const soon = await repo.create('logo', '2026-06-10T09:00:00Z');
    assert.ok(noDue.ok && later.ok && soon.ok);
    const bad = await repo.create('ruim', 'não é data');
    assert.ok(!bad.ok && bad.error.code === 'invalid_due');
    let list = await repo.list();
    assert.deepEqual(list.active.map((x) => x.title), ['logo', 'depois', 'sem prazo'], 'com prazo primeiro, por data');

    const changes: string[] = [];
    const repo2 = new SqliteTaskRepository(t.db, { onChange: (c) => changes.push(c.type) });
    const set = await repo2.setDue(noDue.value.id, '2026-06-09T08:00:00Z');
    assert.ok(set.ok && set.value.dueAt === '2026-06-09T08:00:00.000Z');
    await repo2.setDue(noDue.value.id, '2026-06-09T08:00:00Z'); // igual: não avisa de novo
    assert.deepEqual(changes, ['updated']);
    const cleared = await repo2.setDue(noDue.value.id, null);
    assert.ok(cleared.ok && cleared.value.dueAt === null);
    const missing = await repo2.setDue('33333333-3333-4333-8333-333333333333', null);
    assert.ok(!missing.ok && missing.error.code === 'not_found');
    const invalidId = await repo2.setDue('abc', null);
    assert.ok(!invalidId.ok && invalidId.error.code === 'invalid_id');
    list = await repo.list();
    assert.equal(list.active.find((x) => x.title === 'sem prazo')!.dueAt, null);
  } finally {
    t.close();
  }
});

test('dueStatus: atrasada, hoje, depois e sem prazo (concluída nunca é "atrasada")', () => {
  const now = new Date(2026, 5, 10, 12, 0);
  const at = (d: Date) => ({ dueAt: d.toISOString(), completed: false });
  assert.equal(dueStatus({ dueAt: null, completed: false }, now), 'none');
  assert.equal(dueStatus(at(new Date(2026, 5, 10, 8, 0)), now), 'overdue');
  assert.equal(dueStatus(at(new Date(2026, 5, 10, 18, 0)), now), 'today');
  assert.equal(dueStatus(at(new Date(2026, 5, 11, 9, 0)), now), 'later');
  assert.equal(dueStatus({ dueAt: new Date(2026, 5, 1).toISOString(), completed: true }, now), 'none');
});
