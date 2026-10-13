import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReminderScheduler, REMINDER_GRACE_MS, type Reminder } from '../electron/reminders.ts';

const MIN = 60_000;
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function setup(config = { enabled: true, leadMinutes: 10 }, start = Date.parse('2026-06-10T09:00:00Z')) {
  let t = start;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const fired: Reminder[] = [];
  const scheduler = new ReminderScheduler({
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    config,
    onReminder: (r) => fired.push(r),
  });
  return {
    scheduler,
    fired,
    timers,
    now: () => t,
    /** Avança o relógio executando os timers vencidos em ordem (inclusive os criados no caminho). */
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        t = Math.max(t, next[1].at);
        timers.delete(next[0]);
        next[1].fn();
      }
      t = end;
    },
  };
}

const task = (id: string, title: string, dueAt: string | null, completed = false) => ({ id, title, dueAt, completed });

test('avisa 10 min antes e na hora marcada, uma vez cada', () => {
  const s = setup();
  s.scheduler.sync([task(ID_A, 'Enviar relatório', '2026-06-10T10:00:00.000Z')]);
  s.advance(49 * MIN);
  assert.equal(s.fired.length, 0);
  s.advance(1 * MIN + 1);
  assert.deepEqual(s.fired.map((r) => [r.kind, r.minutes, r.title]), [['soon', 10, 'Enviar relatório']]);
  s.advance(10 * MIN);
  assert.deepEqual(s.fired.map((r) => r.kind), ['soon', 'due']);
  s.advance(5 * 60 * MIN);
  assert.equal(s.fired.length, 2, 'nada se repete');
});

test('antecedência 0: só na hora marcada', () => {
  const s = setup({ enabled: true, leadMinutes: 0 });
  s.scheduler.sync([task(ID_A, 'X', '2026-06-10T09:30:00.000Z')]);
  s.advance(31 * MIN);
  assert.deepEqual(s.fired.map((r) => r.kind), ['due']);
});

test('desligado: nada é anunciado; ligar de novo agenda o que ainda vem', () => {
  const s = setup({ enabled: false, leadMinutes: 10 });
  s.scheduler.sync([task(ID_A, 'X', '2026-06-10T10:00:00.000Z')]);
  s.advance(70 * MIN);
  assert.equal(s.fired.length, 0);
  const t2 = setup({ enabled: false, leadMinutes: 10 });
  t2.scheduler.sync([task(ID_A, 'X', '2026-06-10T10:00:00.000Z')]);
  t2.advance(10 * MIN);
  t2.scheduler.setConfig({ enabled: true, leadMinutes: 10 });
  t2.advance(60 * MIN);
  assert.deepEqual(t2.fired.map((r) => r.kind), ['soon', 'due'], 'ligou antes da antecedência: agenda os dois');
});

test('concluir, excluir ou tirar o prazo antes da hora cancela o aviso', () => {
  const s = setup();
  s.scheduler.sync([task(ID_A, 'A', '2026-06-10T10:00:00.000Z'), task(ID_B, 'B', '2026-06-10T10:00:00.000Z')]);
  s.advance(20 * MIN);
  s.scheduler.sync([task(ID_A, 'A', '2026-06-10T10:00:00.000Z', true), task(ID_B, 'B', null)]);
  s.advance(2 * 60 * MIN);
  assert.equal(s.fired.length, 0);
  assert.equal(s.timers.size, 0, 'sem timers pendentes');
});

test('mudar o prazo reagenda (e o aviso antigo não dispara)', () => {
  const s = setup();
  s.scheduler.sync([task(ID_A, 'A', '2026-06-10T10:00:00.000Z')]);
  s.advance(10 * MIN);
  s.scheduler.sync([task(ID_A, 'A', '2026-06-10T12:00:00.000Z')]);
  s.advance(3 * 60 * MIN);
  assert.deepEqual(s.fired.map((r) => [r.kind, r.dueAt]), [
    ['soon', '2026-06-10T12:00:00.000Z'],
    ['due', '2026-06-10T12:00:00.000Z'],
  ]);
});

test('ao abrir o app: vencidas há muito tempo não são anunciadas; as de agora (≤ 1 min) são', () => {
  const s = setup();
  s.scheduler.sync([
    task(ID_A, 'velha', '2026-06-09T10:00:00.000Z'),
    task(ID_B, 'agora', new Date(s.now() - REMINDER_GRACE_MS + 5_000).toISOString()),
  ]);
  s.advance(1);
  assert.deepEqual(s.fired.map((r) => r.title), ['agora']);
});

test('aviso antecipado já passado, com o prazo ainda no futuro, não é anunciado retroativamente', () => {
  const s = setup(); // 09:00; prazo 09:05, antecedência 10 min → "soon" seria 08:55 (passou)
  s.scheduler.sync([task(ID_A, 'X', '2026-06-10T09:05:00.000Z')]);
  s.advance(6 * MIN);
  assert.deepEqual(s.fired.map((r) => r.kind), ['due']);
});

test('várias tarefas com o mesmo prazo: todas avisam; ordem estável por horário', () => {
  const s = setup({ enabled: true, leadMinutes: 0 });
  s.scheduler.sync([
    task(ID_B, 'depois', '2026-06-10T09:20:00.000Z'),
    task(ID_A, 'antes', '2026-06-10T09:10:00.000Z'),
  ]);
  s.advance(30 * MIN);
  assert.deepEqual(s.fired.map((r) => r.title), ['antes', 'depois']);
});

test('prazos muito distantes: usa esperas limitadas e ainda dispara no dia certo', () => {
  const s = setup({ enabled: true, leadMinutes: 0 });
  s.scheduler.sync([task(ID_A, 'longe', '2026-06-12T09:00:00.000Z')]);
  assert.ok([...s.timers.values()][0].at - s.now() <= 6 * 60 * MIN, 'espera limitada a 6 h');
  s.advance(2 * 24 * 60 * MIN + 1);
  assert.deepEqual(s.fired.map((r) => r.kind), ['due']);
});

test('dispose cancela tudo; prazo inválido é ignorado sem quebrar', () => {
  const s = setup();
  s.scheduler.sync([task(ID_A, 'X', 'não é data'), task(ID_B, 'Y', '2026-06-10T10:00:00.000Z')]);
  s.scheduler.dispose();
  s.advance(3 * 60 * MIN);
  assert.equal(s.fired.length, 0);
});

test('erro no ouvinte não derruba o agendador nem perde os próximos', () => {
  let t = Date.parse('2026-06-10T09:00:00Z');
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const seen: string[] = [];
  const sched = new ReminderScheduler({
    now: () => t,
    setTimer: (fn, ms) => {
      timers.set(++id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    config: { enabled: true, leadMinutes: 0 },
    onReminder: (r) => {
      seen.push(r.title);
      if (r.title === 'ruim') throw new Error('falha');
    },
  });
  sched.sync([task(ID_A, 'ruim', '2026-06-10T09:10:00.000Z'), task(ID_B, 'bom', '2026-06-10T09:20:00.000Z')]);
  for (const step of [11, 10]) {
    t += step * MIN;
    const due = [...timers.values()].filter((x) => x.at <= t);
    timers.clear();
    due.forEach((x) => x.fn());
  }
  assert.deepEqual(seen, ['ruim', 'bom']);
});
