import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FocusTimer, type FinishedSession } from '../electron/focus/focusTimer.ts';
import { DEFAULT_FOCUS_CONFIG, type FocusState } from '../shared/focus.ts';

const MIN = 60_000;

function make(startAt: number) {
  let t = startAt;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 1;
  const finished: FinishedSession[] = [];
  const timer = new FocusTimer({
    now: () => t,
    setTimer: (fn, ms) => {
      const h = id++;
      timers.set(h, { at: t + ms, fn });
      return h;
    },
    clearTimer: (h) => void timers.delete(h as number),
    onFinished: (_k, s) => finished.push(s),
    config: { ...DEFAULT_FOCUS_CONFIG, cycle: true },
  });
  return {
    timer,
    finished,
    advance(ms: number) {
      t += ms;
      for (const [h, x] of [...timers]) {
        if (x.at <= t) {
          timers.delete(h);
          x.fn();
        }
      }
    },
  };
}

/** Estado como foi salvo antes de o app ser fechado. */
const saved = (patch: Partial<FocusState>): FocusState => ({
  status: 'running',
  kind: 'focus',
  durationMs: 25 * MIN,
  endsAt: 1_000_000 + 10 * MIN,
  remainingMs: 10 * MIN,
  task: { id: '11111111-1111-4111-8111-111111111111', title: 'Estudar' },
  cycleCount: 1,
  cycleEnabled: true,
  next: null,
  ...patch,
});

test('restaurar sessão em andamento: continua do horário real e termina na hora certa', () => {
  const m = make(1_000_000);
  m.timer.restore(saved({}));
  assert.equal(m.timer.getState().status, 'running');
  m.advance(9 * MIN);
  assert.equal(m.finished.length, 0);
  m.advance(MIN);
  assert.equal(m.timer.getState().status, 'finished');
  assert.equal(m.finished.length, 1);
  assert.equal(m.finished[0].task?.title, 'Estudar');
  assert.equal(m.timer.getState().cycleCount, 2);
});

test('restaurar depois do horário: termina na hora, com o horário real do fim, uma única vez', () => {
  const m = make(1_000_000 + 40 * MIN); // o app ficou fechado 40 min (a sessão acabou há 30)
  m.timer.restore(saved({}));
  const s = m.timer.getState();
  assert.equal(s.status, 'finished');
  assert.equal(m.finished.length, 1);
  assert.equal(m.finished[0].at, 1_000_000 + 10 * MIN, 'registra o instante em que realmente terminou');
  m.advance(MIN);
  assert.equal(m.finished.length, 1, 'não repete');
});

test('restaurar sessão pausada mantém o tempo restante e retoma normalmente', () => {
  const m = make(5_000_000);
  m.timer.restore(saved({ status: 'paused', endsAt: null, remainingMs: 7 * MIN }));
  assert.equal(m.timer.getState().status, 'paused');
  assert.equal(m.timer.getState().remainingMs, 7 * MIN);
  m.timer.resume();
  m.advance(7 * MIN);
  assert.equal(m.timer.getState().status, 'finished');
});

test('restaurar dado inválido ou em repouso é ignorado (nunca lança)', () => {
  const m = make(1);
  m.timer.configure({ ...DEFAULT_FOCUS_CONFIG });
  assert.doesNotThrow(() => m.timer.restore({ ...saved({}), status: 'idle' }));
  assert.doesNotThrow(() => m.timer.restore({ ...saved({}), durationMs: -5 }));
  assert.doesNotThrow(() => m.timer.restore({ ...saved({}), kind: 'x' as never }));
  assert.equal(m.timer.getState().status, 'idle');
});
