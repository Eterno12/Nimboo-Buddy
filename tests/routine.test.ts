import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutine, dayKey, isDayKey, pickRoutine, routineText, type RoutineInput } from '../shared/routine.ts';
import type { CalendarEvent } from '../shared/calendar.ts';
import type { Task } from '../shared/tasks.ts';

const NOW = new Date(2026, 9, 14, 9, 30); // 14/10/2026 09:30
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  title: `Tarefa ${n}`,
  completed: false,
  createdAt: at(1, 8),
  completedAt: null,
  updatedAt: at(1, 8),
  dueAt: null,
  sourceRef: null,
  priority: 0,
  recurrence: null,
  parentId: null,
  position: null,
  ...over,
});
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `e${++n}|1`,
  title: `Evento ${n}`,
  start: at(14, 14),
  end: at(14, 15),
  allDay: false,
  location: null,
  ...over,
});

const input = (over: Partial<RoutineInput> = {}): RoutineInput => ({
  now: NOW,
  active: [],
  completed: [],
  events: [],
  focus: { sessions: 0, minutes: 0 },
  ...over,
});

test('dayKey e isDayKey: data local AAAA-MM-DD', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.ok(isDayKey('2026-10-14'));
  for (const bad of ['14/10/2026', '2026-1-1', 20261014, null, '2026-10-14T10:00']) assert.equal(isDayKey(bad), false);
});

test('pickRoutine: manhã no primeiro uso do dia; noite depois da hora; cada uma uma vez por dia', () => {
  const base = { morningEnabled: true, eveningEnabled: true, eveningHour: 18, lastMorning: null, lastEvening: null };
  assert.equal(pickRoutine({ ...base, now: new Date(2026, 9, 14, 9, 0) }), 'morning');
  assert.equal(pickRoutine({ ...base, now: new Date(2026, 9, 14, 9, 0), lastMorning: '2026-10-14' }), null);
  assert.equal(pickRoutine({ ...base, now: new Date(2026, 9, 14, 18, 0), lastMorning: '2026-10-14' }), 'evening');
  assert.equal(pickRoutine({ ...base, now: new Date(2026, 9, 14, 19, 0) }), 'evening', 'a noite vence a manhã não vista');
  assert.equal(pickRoutine({ ...base, now: new Date(2026, 9, 14, 19, 0), lastEvening: '2026-10-14' }), null);
  assert.equal(pickRoutine({ ...base, now: new Date(2026, 9, 15, 9, 0), lastMorning: '2026-10-14' }), 'morning', 'dia novo');
  assert.equal(pickRoutine({ ...base, morningEnabled: false, now: new Date(2026, 9, 14, 9, 0) }), null);
  assert.equal(pickRoutine({ ...base, eveningEnabled: false, now: new Date(2026, 9, 14, 20, 0) }), 'morning', 'sem fechamento, o resumo vale o dia todo');
  assert.equal(pickRoutine({ ...base, eveningEnabled: false, now: new Date(2026, 9, 14, 20, 0), lastMorning: '2026-10-14' }), null);
});

test('manhã: conta atrasadas, de hoje e eventos; destaca na ordem atrasada → hoje → prioridade alta', () => {
  const overdue = task({ title: 'Pagar boleto', dueAt: at(13, 10) });
  const today = task({ title: 'Enviar relatório', dueAt: at(14, 17) });
  const high = task({ title: 'Estudar', priority: 3 });
  const later = task({ title: 'Depois', dueAt: at(20, 9) });
  const sub = task({ title: 'Sub', parentId: today.id, dueAt: at(14, 12) });
  const s = buildRoutine(
    'morning',
    input({
      active: [later, high, today, overdue, sub],
      events: [event({ title: 'Reunião', start: at(14, 11), end: at(14, 12) })],
    }),
  );
  assert.deepEqual(
    [s.counts.pending, s.counts.overdue, s.counts.dueToday, s.counts.eventsToday],
    [4, 1, 1, 1],
    'subtarefa não entra',
  );
  assert.deepEqual(s.highlights.map((h) => [h.title, h.reason]), [
    ['Pagar boleto', 'overdue'],
    ['Enviar relatório', 'today'],
    ['Estudar', 'priority'],
  ]);
  assert.match(s.lines.join(' '), /2 tarefas pedem atenção e 1 evento/);
  assert.match(s.lines.join(' '), /Próximo: 11:00 — Reunião/);
  assert.equal(s.greeting, 'Bom dia!');
  assert.ok(s.bubble.length <= 56, s.bubble);
});

test('manhã: dia livre e eventos que já terminaram não contam', () => {
  const free = buildRoutine('morning', input());
  assert.match(free.lines[0], /dia está livre/);
  assert.match(free.bubble, /Dia livre/);
  const past = buildRoutine('morning', input({ events: [event({ start: at(14, 7), end: at(14, 8) })] }));
  assert.equal(past.counts.eventsToday, 0);
});

test('noite: concluídas hoje, foco e pendências; nada de culpa quando nada foi feito', () => {
  const doneToday = task({ completed: true, completedAt: at(14, 10), title: 'Feita' });
  const doneYesterday = task({ completed: true, completedAt: at(13, 22) });
  const open = task({ title: 'Aberta', dueAt: at(14, 22) });
  const s = buildRoutine('evening', {
    ...input({ now: new Date(2026, 9, 14, 18, 0) }),
    active: [open],
    completed: [doneToday, doneYesterday],
    focus: { sessions: 2, minutes: 50 },
  });
  assert.equal(s.counts.completedToday, 1);
  assert.match(s.lines.join(' '), /concluiu 1 tarefa hoje/);
  assert.match(s.lines.join(' '), /Foco: 2 sessões \(50 min\)/);
  assert.match(s.lines.join(' '), /1 pendente/);
  assert.equal(s.greeting, 'Boa noite!');

  const empty = buildRoutine('evening', input({ now: new Date(2026, 9, 14, 19, 0) }));
  assert.match(empty.lines[0], /nenhuma tarefa foi concluída — tudo bem/);
  assert.match(empty.lines.at(-1) ?? '', /Lista zerada/);
  assert.ok(s.bubble.length <= 56 && empty.bubble.length <= 56);
});

test('routineText: junta o cartão em texto para o assistente', () => {
  const s = buildRoutine('morning', input({ active: [task({ title: 'Ligar', dueAt: at(13, 9) })] }));
  const text = routineText(s);
  assert.match(text, /Bom dia!/);
  assert.match(text, /• Ligar \(atrasada\)/);
});
