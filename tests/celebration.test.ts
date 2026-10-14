import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hardReason, HARD_TEXT, type HardInput } from '../shared/celebration.ts';
import { createPersonality, isLateNight, LINES } from '../src/features/personality/personality.ts';

const DAY = 24 * 3_600_000;
const base: HardInput = {
  priority: 0,
  dueAt: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  completedAt: '2026-10-14T12:00:00.000Z',
  subtasks: 0,
  isSubtask: false,
};

test('tarefa difícil: prioridade alta, atraso, subtarefas e tarefa antiga', () => {
  assert.equal(hardReason(base), null);
  assert.equal(hardReason({ ...base, priority: 3 }), 'priority');
  assert.equal(hardReason({ ...base, priority: 2 }), null);
  assert.equal(hardReason({ ...base, dueAt: '2026-10-14T11:00:00.000Z' }), 'late');
  assert.equal(hardReason({ ...base, dueAt: '2026-10-14T13:00:00.000Z' }), null, 'no prazo não é atraso');
  assert.equal(hardReason({ ...base, subtasks: 1 }), null);
  assert.equal(hardReason({ ...base, subtasks: 2 }), 'subtasks');
  const created = new Date(Date.parse(base.completedAt as string) - 3 * DAY).toISOString();
  assert.equal(hardReason({ ...base, createdAt: created }), 'old');
  assert.equal(hardReason({ ...base, createdAt: new Date(Date.parse(created) + 1000).toISOString() }), null);
});

test('tarefa difícil: subtarefas e dados inválidos nunca comemoram', () => {
  assert.equal(hardReason({ ...base, priority: 3, isSubtask: true }), null);
  assert.equal(hardReason({ ...base, priority: 3, completedAt: null }), null);
  assert.equal(hardReason({ ...base, priority: 3, completedAt: 'lixo' }), null);
  for (const t of Object.values(HARD_TEXT)) assert.ok(t.length <= 56, t);
});

test('contexto: madrugada, fim de semana e segunda-feira mudam as frases do "hello"', () => {
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h, 0, 0);
  assert.equal(isLateNight(at(2026, 9, 14, 3)), true);
  assert.equal(isLateNight(at(2026, 9, 14, 5)), false);
  const pickAll = (when: Date) => {
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      // cada tentativa usa uma personalidade nova (sem intervalos) e um sorteio diferente
      const p = createPersonality(() => (i % 20) / 20);
      const text = p.pick('hello', { now: when, mood: 'mid', focusActive: false });
      if (text) seen.add(text);
    }
    return seen;
  };
  const weekend = LINES.hello.filter((l) => l.days?.includes(6)).map((l) => l.text);
  const late = LINES.hello.filter((l) => l.late).map((l) => l.text);
  assert.ok(weekend.length >= 2 && late.length >= 2);
  // sábado à tarde: nada de frases de madrugada nem de segunda
  const sat = pickAll(at(2026, 9, 17, 15));
  assert.ok([...sat].some((t) => weekend.includes(t)));
  assert.ok([...sat].every((t) => !late.includes(t) && t !== 'Segunda! Um passo de cada vez.'));
  // quarta às 3h: frases de madrugada possíveis, nunca as de fim de semana
  const night = pickAll(at(2026, 9, 14, 3));
  assert.ok([...night].some((t) => late.includes(t)));
  assert.ok([...night].every((t) => !weekend.includes(t)));
});
