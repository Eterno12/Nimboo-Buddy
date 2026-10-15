import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../shared/tasks.ts';
import { poseFor, type PoseInput } from '../shared/mascotPose.ts';
import { buildWidgetSnapshot, parseInbox } from '../mobile/src/widget.ts';
import { DEFAULT_PROFILE } from '../mobile/src/profile.ts';

const MIN = 60_000;
const NOW = new Date(2026, 9, 15, 14, 0, 0).getTime(); // 14:00 local

const base: PoseInput = { now: NOW, overdue: 0, nextDueInMin: null, lastCompletedMsAgo: null, hour: 14 };

test('pose: comemora logo depois de concluir, estranha atraso, fica curioso com prazo perto, dorme à noite', () => {
  assert.equal(poseFor({ ...base, lastCompletedMsAgo: 3 * MIN }), 'celebrate');
  assert.equal(poseFor({ ...base, lastCompletedMsAgo: 40 * MIN }), 'idle');
  assert.equal(poseFor({ ...base, overdue: 2 }), 'surprised');
  assert.equal(poseFor({ ...base, nextDueInMin: 20 }), 'curious');
  assert.equal(poseFor({ ...base, nextDueInMin: 90 }), 'idle');
  assert.equal(poseFor({ ...base, hour: 23 }), 'sleepy');
  assert.equal(poseFor({ ...base, hour: 3 }), 'sleepy');
  // Prioridade: concluir > atraso > prazo perto > noite > repouso feliz.
  assert.equal(poseFor({ ...base, hour: 23, overdue: 1, lastCompletedMsAgo: MIN }), 'celebrate');
  assert.equal(poseFor({ ...base, hour: 23, overdue: 1 }), 'surprised');
});

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
  title: `Tarefa ${id}`,
  completed: false,
  createdAt: '2026-10-15T08:00:00.000Z',
  completedAt: null,
  updatedAt: '2026-10-15T08:00:00.000Z',
  dueAt: null,
  sourceRef: null,
  priority: 0,
  recurrence: null,
  parentId: null,
  position: null,
  ...patch,
});

test('resumo do widget: próximas 3 tarefas, contadores, pose e perfil', () => {
  const tasks = [
    task('1', { dueAt: new Date(NOW + 20 * MIN).toISOString(), priority: 3 }),
    task('2', { dueAt: new Date(NOW - 60 * MIN).toISOString() }),
    task('3'),
    task('4', { dueAt: new Date(NOW + 5 * 60 * MIN).toISOString() }),
    task('5', { dueAt: new Date(NOW + 6 * 60 * MIN).toISOString() }),
    task('6', { completed: true, completedAt: new Date(NOW - 2 * MIN).toISOString(), dueAt: new Date(NOW).toISOString() }),
    task('7', { parentId: '00000000-0000-4000-8000-000000000001', dueAt: new Date(NOW + MIN).toISOString() }),
  ];
  const snap = buildWidgetSnapshot(tasks, NOW, { ...DEFAULT_PROFILE, character: 'cactus', skin: 'cactus.escuros' });
  assert.equal(snap.version, 1);
  assert.equal(snap.character, 'cactus');
  assert.equal(snap.skin, 'cactus.escuros');
  assert.deepEqual(snap.tasks.map((t) => t.title), ['Tarefa 2', 'Tarefa 1', 'Tarefa 4']);
  assert.equal(snap.overdue, 1);
  assert.equal(snap.total, 5);
  assert.equal(snap.pose, 'celebrate', 'concluiu uma há 2 min');
  assert.equal(snap.tasks[0].overdue, true);
  assert.match(snap.tasks[1].due, /^\d{2}:\d{2}$/, 'hoje mostra só a hora');
});

test('caixa de entrada do widget: aceita só ações válidas e ignora o resto', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  assert.deepEqual(parseInbox(JSON.stringify([{ action: 'complete', taskId: id }, { action: 'complete', taskId: id }])), [{ action: 'complete', taskId: id }]);
  assert.deepEqual(parseInbox(JSON.stringify([{ action: 'delete', taskId: id }, { action: 'complete', taskId: '../x' }, 7])), []);
  assert.deepEqual(parseInbox('{lixo'), []);
  assert.deepEqual(parseInbox(null), []);
});
