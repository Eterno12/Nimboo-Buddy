import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeek, dayKey, formatMinutes, lastDays } from '../shared/stats.ts';

const NOW = new Date(2026, 9, 14, 15, 0, 0); // 14/10/2026, quarta
const at = (dayOffset: number, hour = 10) => new Date(2026, 9, 14 + dayOffset, hour, 0, 0).toISOString();

test('estatísticas: 7 dias locais terminando hoje, atravessando o fim do mês', () => {
  const days = lastDays(new Date(2026, 10, 2, 9), 7);
  assert.deepEqual(days, ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.equal(dayKey(NOW), '2026-10-14');
});

test('estatísticas: agrupa foco e tarefas por dia e ignora o que está fora da semana', () => {
  const w = buildWeek(
    {
      focus: [
        { at: at(0, 9), minutes: 25 },
        { at: at(0, 14), minutes: 25 },
        { at: at(-2), minutes: 50 },
        { at: at(-7), minutes: 99 }, // fora (8 dias atrás)
        { at: at(1), minutes: 10 }, // futuro: fora
        { at: 'lixo', minutes: 25 },
        { at: at(-1), minutes: -5 },
      ],
      tasks: [at(0), at(0, 18), at(-3), at(-30), 'x'],
    },
    NOW,
  );
  assert.equal(w.days.length, 7);
  assert.equal(w.days[6].day, '2026-10-14');
  assert.deepEqual(
    [w.days[6].focusMinutes, w.days[6].focusSessions, w.days[6].tasksCompleted],
    [50, 2, 2],
  );
  assert.equal(w.days[4].focusMinutes, 50);
  assert.equal(w.days[3].tasksCompleted, 1);
  assert.deepEqual(w.totals, { focusMinutes: 100, focusSessions: 3, tasksCompleted: 3 });
  assert.equal(w.avgFocusMinutes, 50);
  assert.equal(w.activeDays, 3);
  // empate de minutos: fica o dia mais antigo (o primeiro encontrado)
  assert.equal(w.bestFocusDay, '2026-10-12');
});

test('estatísticas: semana vazia não quebra', () => {
  const w = buildWeek({ focus: [], tasks: [] }, NOW);
  assert.equal(w.bestFocusDay, null);
  assert.equal(w.avgFocusMinutes, 0);
  assert.equal(w.activeDays, 0);
});

test('estatísticas: formatação de minutos', () => {
  assert.equal(formatMinutes(0), '0 min');
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(65), '1 h 05');
  assert.equal(formatMinutes(120), '2 h 00');
  assert.equal(formatMinutes(-3), '0 min');
});
