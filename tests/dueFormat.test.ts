import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDue, fromLocalInputValue, presetDue, toLocalInputValue } from '../src/features/tasks/dueFormat.ts';

test('valor local ↔ ISO é uma ida e volta exata (no fuso do computador)', () => {
  const iso = fromLocalInputValue('2026-06-10T18:30')!;
  assert.ok(iso.endsWith('.000Z'));
  assert.equal(toLocalInputValue(iso), '2026-06-10T18:30');
  assert.equal(new Date(iso).getHours(), 18);
});

test('valores inválidos viram null; datas "corrigidas" pelo calendário também', () => {
  for (const bad of ['', 'amanhã', '2026-06-10', '2026-06-10 18:30', '2026-13-10T10:00', '2026-02-31T10:00', '2026-06-10T25:00']) {
    assert.equal(fromLocalInputValue(bad), null, bad);
  }
  assert.equal(toLocalInputValue(null), '');
  assert.equal(toLocalInputValue('lixo'), '');
});

test('formatDue: hoje, amanhã, ontem e data', () => {
  const now = new Date(2026, 5, 10, 12, 0);
  const at = (d: number, h: number, m = 0) => new Date(2026, 5, d, h, m).toISOString();
  assert.equal(formatDue(at(10, 18), now), 'hoje 18:00');
  assert.equal(formatDue(at(11, 9, 5), now), 'amanhã 09:05');
  assert.equal(formatDue(at(9, 8, 30), now), 'ontem 08:30');
  assert.equal(formatDue(at(20, 7), now), '20/06 07:00');
  assert.equal(formatDue('lixo', now), '');
});

test('presetDue: hoje 18:00 (ou daqui a 1 h se já passou) e amanhã 09:00', () => {
  const morning = new Date(2026, 5, 10, 9, 15);
  assert.equal(presetDue('today', morning), '2026-06-10T18:00');
  const night = new Date(2026, 5, 10, 19, 20);
  assert.equal(presetDue('today', night), '2026-06-10T20:20');
  assert.equal(presetDue('tomorrow', night), '2026-06-11T09:00');
});
