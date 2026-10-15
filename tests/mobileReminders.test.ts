import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Task } from '../shared/tasks.ts';
import type { SqlJsModule } from '../mobile/db/sqlJsDatabase.ts';
import type { BlobStore } from '../mobile/db/persistence.ts';
import { createCore } from '../mobile/src/core.ts';
import { planReminders, reminderId, type ReminderPlan } from '../mobile/src/reminders.ts';
import type { Notifier } from '../mobile/src/platform/notifier.ts';

const NOW = new Date('2026-10-15T12:00:00.000Z').getTime();
const MIN = 60_000;
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
const iso = (offsetMin: number) => new Date(NOW + offsetMin * MIN).toISOString();

test('plano: aviso antes e na hora; ignora vencidas, concluídas, sem prazo e subtarefas', () => {
  const tasks = [
    task('1', { dueAt: iso(30) }),
    task('2', { dueAt: iso(-5) }),
    task('3', { dueAt: iso(60), completed: true }),
    task('4'),
    task('5', { dueAt: iso(45), parentId: '00000000-0000-4000-8000-000000000001' }),
  ];
  const plan = planReminders(tasks, NOW, { enabled: true, leadMinutes: 10 });
  assert.deepEqual(
    plan.map((p) => [p.kind, p.at - NOW]),
    [
      ['soon', 20 * MIN],
      ['due', 30 * MIN],
    ],
  );
  assert.match(plan[0].title, /10 minutos/);
  assert.equal(plan[1].title, 'Chegou a hora');
  assert.equal(plan[1].body, 'Tarefa 1');
});

test('plano: sem antecedência só avisa na hora; desligado não agenda nada; aviso antecipado que já passou some', () => {
  const t = task('1', { dueAt: iso(5) });
  assert.deepEqual(planReminders([t], NOW, { enabled: true, leadMinutes: 0 }).map((p) => p.kind), ['due']);
  assert.deepEqual(planReminders([t], NOW, { enabled: false, leadMinutes: 10 }), []);
  assert.deepEqual(planReminders([t], NOW, { enabled: true, leadMinutes: 10 }).map((p) => p.kind), ['due'], 'faltam 5 min: o aviso de 10 já passou');
});

test('plano: ids estáveis e únicos, no máximo 60 avisos, os mais próximos primeiro', () => {
  const a = task('1', { dueAt: iso(30) });
  assert.equal(reminderId(a.id, 'due', a.dueAt as string), reminderId(a.id, 'due', a.dueAt as string));
  assert.notEqual(reminderId(a.id, 'due', a.dueAt as string), reminderId(a.id, 'soon', a.dueAt as string));
  assert.ok(reminderId(a.id, 'due', a.dueAt as string) >= 10_000, 'não colide com o aviso do foco');

  const many = Array.from({ length: 80 }, (_, i) => task(String(i + 1), { dueAt: iso(20 + i) }));
  const plan = planReminders(many, NOW, { enabled: true, leadMinutes: 0 });
  assert.equal(plan.length, 60);
  assert.deepEqual(plan.map((p) => p.at), [...plan.map((p) => p.at)].sort((x, y) => x - y));
  assert.equal(new Set(plan.map((p) => p.id)).size, 60);
});

// ---- integração com o núcleo -------------------------------------------------------------------

const initSqlJs = createRequire(import.meta.url)('sql.js') as () => Promise<SqlJsModule>;

function recordingNotifier() {
  const plans: ReminderPlan[][] = [];
  const n: Notifier & { plans: ReminderPlan[][] } = {
    plans,
    scheduleFocusEnd: async () => {},
    cancelFocusEnd: async () => {},
    requestPermission: async () => true,
    scheduleReminders: async (p) => void plans.push([...p]),
    scheduleSnooze: async () => {},
    onReminderAction: () => () => {},
  };
  return n;
}

test('núcleo: criar, concluir e mudar o prazo reagenda os avisos', async () => {
  const notifier = recordingNotifier();
  let t = NOW;
  const blob: BlobStore = { read: async () => null, write: async () => {} };
  const core = await createCore({
    SQL: await initSqlJs(),
    blob,
    session: { read: () => null, write: () => {}, clear: () => {} },
    fetch: async () => {
      throw new Error('sem rede');
    },
    url: 'http://127.0.0.1:1',
    anonKey: 'x',
    debounceMs: 5,
    notifier,
    now: () => t,
    reminderDelayMs: 0,
  });
  const created = await core.tasks.create('Consulta', iso(60));
  assert.ok(created.ok);
  const id = created.ok ? created.value.id : '';
  await new Promise((r) => setTimeout(r, 20));
  const afterCreate = notifier.plans.at(-1) ?? [];
  assert.deepEqual(afterCreate.map((p) => p.kind), ['soon', 'due']);

  await core.tasks.complete(id);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(notifier.plans.at(-1), [], 'concluída: sem avisos');

  core.setReminderConfig({ enabled: true, leadMinutes: 0 });
  const second = await core.tasks.create('Outra', iso(90));
  assert.ok(second.ok);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual((notifier.plans.at(-1) ?? []).map((p) => p.kind), ['due']);
  t += 0;
  await core.close();
});
