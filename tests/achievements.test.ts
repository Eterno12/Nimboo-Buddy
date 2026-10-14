import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  ALL_ACHIEVEMENTS,
  EMPTY_BOND,
  MAX_POINTS,
  PLATINUM,
  TIER_POINTS,
  applyBondEvent,
  buildSnapshot,
  newlyUnlocked,
  pointsOf,
  progressOf,
  type BondEvent,
  type BondState,
} from '../shared/achievements.ts';

const at = (d: number, h = 12) => new Date(2026, 9, d, h, 0);
const run = (events: [BondEvent, Date][], start: BondState = EMPTY_BOND) =>
  events.reduce((s, [e, when]) => applyBondEvent(s, e, when), start);

test('definições: ids únicos, metas positivas e a pontuação máxima confere', () => {
  const ids = ALL_ACHIEVEMENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.stat && (a.target ?? 0) > 0, a.id);
    assert.ok(a.title.length > 0 && a.description.length > 0);
  }
  assert.equal(
    MAX_POINTS,
    ALL_ACHIEVEMENTS.reduce((s, a) => s + TIER_POINTS[a.tier], 0),
  );
});

test('contadores: tarefas, notas, foco (minutos limitados), carinhos, assistente', () => {
  const s = run([
    [{ type: 'task_created' }, at(14)],
    [{ type: 'task_completed' }, at(14)],
    [{ type: 'task_completed' }, at(14)],
    [{ type: 'note_created' }, at(14)],
    [{ type: 'focus_finished', minutes: 25 }, at(14)],
    [{ type: 'focus_finished', minutes: 99999 }, at(14)],
    [{ type: 'pet' }, at(14)],
    [{ type: 'assistant' }, at(14)],
    [{ type: 'voice' }, at(14)],
    [{ type: 'event_task' }, at(14)],
    [{ type: 'subtask' }, at(14)],
  ]);
  assert.deepEqual(
    [s.stats.tasks_created, s.stats.tasks_completed, s.stats.notes_created, s.stats.focus_sessions, s.stats.pets],
    [1, 2, 1, 2, 1],
  );
  assert.equal(s.stats.focus_minutes, 25 + 600, 'uma sessão nunca soma mais de 600 min');
  assert.deepEqual([s.stats.assistant_commands, s.stats.voice_used, s.stats.event_tasks, s.stats.subtasks], [1, 1, 1, 1]);
});

test('dias: total, sequência e maior sequência; pular um dia reinicia', () => {
  let s = run([
    [{ type: 'open' }, at(10)],
    [{ type: 'pet' }, at(10, 18)], // mesmo dia: não soma
    [{ type: 'open' }, at(11)],
    [{ type: 'open' }, at(12)],
  ]);
  assert.deepEqual([s.stats.days_total, s.stats.streak, s.stats.longest_streak], [3, 3, 3]);
  assert.equal(s.days.firstDay, '2026-10-10');
  s = applyBondEvent(s, { type: 'open' }, at(15)); // pulou 13 e 14
  assert.deepEqual([s.stats.days_total, s.stats.streak, s.stats.longest_streak], [4, 1, 3]);
  // virada de mês
  const m = run([
    [{ type: 'open' }, new Date(2026, 0, 31, 12)],
    [{ type: 'open' }, new Date(2026, 1, 1, 12)],
  ]);
  assert.equal(m.stats.streak, 2);
});

test('horas: madrugada (0–4h) e madrugador (5–6h) só por atividade real, não por abrir', () => {
  assert.equal(run([[{ type: 'open' }, at(14, 3)]]).stats.night_owl, undefined);
  assert.equal(run([[{ type: 'task_created' }, at(14, 3)]]).stats.night_owl, 1);
  assert.equal(run([[{ type: 'task_created' }, at(14, 6)]]).stats.early_bird, 1);
  assert.equal(run([[{ type: 'task_created' }, at(14, 9)]]).stats.early_bird, undefined);
});

test('personagens usados: conta distintos e ignora ids inválidos', () => {
  const s = run([
    [{ type: 'character', id: 'mochi' }, at(14)],
    [{ type: 'character', id: 'cactus' }, at(14)],
    [{ type: 'character', id: 'cactus' }, at(14)],
    [{ type: 'character', id: '../x' }, at(14)],
    [{ type: 'character', id: 'ghost' }, at(14)],
  ]);
  assert.equal(s.stats.characters_used, 3);
  assert.deepEqual(s.days.characters, ['mochi', 'cactus', 'ghost']);
});

test('desbloqueio: metas, uma vez só e platina ao completar todas', () => {
  let s = run([[{ type: 'task_completed' }, at(14)]]);
  assert.deepEqual(newlyUnlocked(s.stats, new Set()), ['first_task']);
  assert.deepEqual(newlyUnlocked(s.stats, new Set(['first_task'])), [], 'não repete');
  for (let i = 0; i < 9; i++) s = applyBondEvent(s, { type: 'task_completed' }, at(14));
  assert.ok(newlyUnlocked(s.stats, new Set(['first_task'])).includes('tasks_10'));

  const everything = new Set(ACHIEVEMENTS.map((a) => a.id));
  const stats = {};
  assert.deepEqual(newlyUnlocked(stats, everything), [PLATINUM.id]);
  assert.deepEqual(newlyUnlocked(stats, new Set([...everything, PLATINUM.id])), []);
});

test('progresso e pontos: limitado à meta; secretas escondem título até desbloquear', () => {
  const a = ACHIEVEMENTS.find((x) => x.id === 'tasks_10')!;
  assert.deepEqual(progressOf(a, { tasks_completed: 4 }, new Set()), { current: 4, target: 10, fraction: 0.4 });
  assert.equal(progressOf(a, { tasks_completed: 400 }, new Set()).current, 10);
  assert.equal(pointsOf(new Set(['first_task', 'tasks_10'])), TIER_POINTS.bronze + TIER_POINTS.silver);

  const snap = buildSnapshot({ ...EMPTY_BOND, stats: { tasks_completed: 1 } }, { first_task: '2026-10-14T10:00:00.000Z' }, 0.5);
  const owl = snap.achievements.find((x) => x.id === 'night_owl')!;
  assert.deepEqual([owl.title, owl.hidden, owl.unlocked], ['???', true, false]);
  const first = snap.achievements.find((x) => x.id === 'first_task')!;
  assert.deepEqual([first.unlocked, first.unlockedAt], [true, '2026-10-14T10:00:00.000Z']);
  assert.equal(snap.points, TIER_POINTS.bronze);
  assert.equal(snap.total, ALL_ACHIEVEMENTS.length);
  assert.equal(snap.title, 'Recém-chegado');
});
