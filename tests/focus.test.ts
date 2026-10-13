import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FocusTimer } from '../electron/focus/focusTimer.ts';
import {
  DEFAULT_FOCUS_CONFIG,
  nextStep,
  validateFocusTask,
  BREAK_MAX_MINUTES,
  FOCUS_MAX_MINUTES,
  IDLE_FOCUS_STATE,
  formatClock,
  progress,
  remainingNow,
  validateSession,
  type FocusKind,
  type FocusState,
} from '../shared/focus.ts';

const MIN = 60_000;

/** Relógio e timers controlados; `onChange`/`onFinished` registrados. */
function setup(startAt = 1_000_000) {
  let t = startAt;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const states: FocusState[] = [];
  const finished: FocusKind[] = [];
  const timer = new FocusTimer({
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    onChange: (s) => states.push(s),
    onFinished: (k) => finished.push(k),
  });
  return {
    timer,
    states,
    finished,
    timers,
    now: () => t,
    /** Avança o relógio; dispara os timers vencidos, em ordem. */
    advance(ms: number) {
      t += ms;
      for (const [id, tm] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (tm.at <= t) {
          timers.delete(id);
          tm.fn();
        }
      }
    },
    /** Muda só o relógio (simula salto/suspensão), sem disparar nada. */
    jump(ms: number) {
      t += ms;
    },
    /** Dispara o primeiro timer agora, mesmo "cedo" (o SO às vezes adianta). */
    fireEarly() {
      const [id, tm] = [...timers][0];
      timers.delete(id);
      tm.fn();
    },
  };
}

test('início: sessão de 25 min corre, com endsAt pelo relógio e sem avisar a cada segundo', () => {
  const s = setup();
  const r = s.timer.start('focus', 25);
  assert.ok(r.ok);
  const st = s.timer.getState();
  assert.equal(st.status, 'running');
  assert.equal(st.kind, 'focus');
  assert.equal(st.durationMs, 25 * MIN);
  assert.equal(st.endsAt, s.now() + 25 * MIN);
  s.advance(10 * MIN);
  assert.equal(s.states.length, 1, 'só a transição de início foi emitida');
  assert.equal(remainingNow(s.timer.getState(), s.now()), 15 * MIN);
});

test('fim: conclui uma única vez, emite finished e chama onFinished com o tipo', () => {
  const s = setup();
  s.timer.start('focus', 1);
  s.advance(MIN - 1);
  assert.equal(s.timer.getState().status, 'running');
  s.advance(1);
  const st = s.timer.getState();
  assert.equal(st.status, 'finished');
  assert.equal(st.remainingMs, 0);
  assert.equal(st.endsAt, null);
  assert.deepEqual(s.finished, ['focus']);
  s.advance(10 * MIN); // nada mais acontece
  assert.deepEqual(s.finished, ['focus']);
});

test('pausa e retomada: o tempo restante é preservado e o relógio parado não consome', () => {
  const s = setup();
  s.timer.start('focus', 25);
  s.advance(5 * MIN);
  const paused = s.timer.pause();
  assert.ok(paused.ok);
  assert.equal(s.timer.getState().status, 'paused');
  assert.equal(s.timer.getState().remainingMs, 20 * MIN);
  assert.equal(s.timers.size, 0, 'sem timer enquanto pausado');

  s.advance(60 * MIN); // uma hora parada: nada acontece
  assert.equal(s.timer.getState().status, 'paused');
  assert.deepEqual(s.finished, []);

  const resumed = s.timer.resume();
  assert.ok(resumed.ok);
  assert.equal(s.timer.getState().endsAt, s.now() + 20 * MIN);
  s.advance(20 * MIN);
  assert.equal(s.timer.getState().status, 'finished');
  assert.deepEqual(s.finished, ['focus']);
});

test('cancelar volta ao repouso sem disparar o fim', () => {
  const s = setup();
  s.timer.start('focus', 10);
  s.advance(3 * MIN);
  assert.ok(s.timer.cancel().ok);
  assert.deepEqual(s.timer.getState(), IDLE_FOCUS_STATE);
  assert.equal(s.timers.size, 0);
  s.advance(60 * MIN);
  assert.deepEqual(s.finished, []);
});

test('cancelar em repouso é inofensivo e não emite estado', () => {
  const s = setup();
  assert.ok(s.timer.cancel().ok);
  assert.equal(s.states.length, 0);
});

test('regras: não sobrescreve sessão em andamento nem pausada; recusa pausar/retomar fora de hora', () => {
  const s = setup();
  s.timer.start('focus', 25);
  const again = s.timer.start('focus', 5);
  assert.ok(!again.ok && again.error.code === 'busy');
  assert.equal(s.timer.getState().durationMs, 25 * MIN, 'a sessão original segue intacta');
  const noResume = s.timer.resume();
  assert.ok(!noResume.ok && noResume.error.code === 'not_paused');
  s.timer.pause();
  const noPause = s.timer.pause();
  assert.ok(!noPause.ok && noPause.error.code === 'not_running');
  const busyPaused = s.timer.start('break', 5);
  assert.ok(!busyPaused.ok && busyPaused.error.code === 'busy');

  const idle = setup();
  assert.equal(!idle.timer.pause().ok, true);
});

test('depois de concluir dá para iniciar a pausa (e depois outro foco)', () => {
  const s = setup();
  s.timer.start('focus', 1);
  s.advance(MIN);
  assert.ok(s.timer.start('break', 5).ok);
  assert.equal(s.timer.getState().kind, 'break');
  s.advance(5 * MIN);
  assert.deepEqual(s.finished, ['focus', 'break']);
  assert.ok(s.timer.start('focus', 25).ok);
});

test('timer que dispara cedo é reavaliado pelo relógio (não conclui antes da hora)', () => {
  const s = setup();
  s.timer.start('focus', 10);
  s.jump(4 * MIN);
  s.fireEarly(); // o SO "adiantou" o timer
  assert.equal(s.timer.getState().status, 'running');
  assert.equal(s.timers.size, 1, 'reagendou o restante');
  s.advance(6 * MIN);
  assert.equal(s.timer.getState().status, 'finished');
});

test('suspensão do computador: ao acordar depois do prazo, conclui na hora', () => {
  const s = setup();
  s.timer.start('focus', 25);
  s.jump(40 * MIN); // dormiu; o relógio do sistema passou do prazo
  s.fireEarly(); // o timer dispara ao acordar
  assert.equal(s.timer.getState().status, 'finished');
  assert.deepEqual(s.finished, ['focus']);
});

test('validação: tipo, inteiro e limites (foco 1–180, pausa 1–60)', () => {
  const s = setup();
  for (const bad of [0, -5, 1.5, NaN, Infinity, FOCUS_MAX_MINUTES + 1, '25', null, undefined]) {
    const r = s.timer.start('focus', bad);
    assert.ok(!r.ok && r.error.code === 'invalid_duration', String(bad));
  }
  assert.ok(!s.timer.start('break', BREAK_MAX_MINUTES + 1).ok);
  assert.ok(!s.timer.start('outro', 5).ok);
  assert.equal(s.timers.size, 0);
  assert.equal(s.states.length, 0);
  assert.ok(validateSession('focus', FOCUS_MAX_MINUTES).ok);
  assert.ok(validateSession('focus', 1).ok);
  assert.ok(validateSession('break', BREAK_MAX_MINUTES).ok);
});

test('dispose: cancela o timer sem emitir nem concluir', () => {
  const s = setup();
  s.timer.start('focus', 5);
  const before = s.states.length;
  s.timer.dispose();
  s.advance(10 * MIN);
  assert.equal(s.states.length, before);
  assert.deepEqual(s.finished, []);
});

test('formatClock: mm:ss, h:mm:ss e arredonda para cima', () => {
  assert.equal(formatClock(25 * MIN), '25:00');
  assert.equal(formatClock(24 * MIN + 59_001), '25:00');
  assert.equal(formatClock(61_000), '01:01');
  assert.equal(formatClock(1), '00:01');
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(-500), '00:00');
  assert.equal(formatClock(60 * MIN), '1:00:00');
  assert.equal(formatClock(180 * MIN), '3:00:00');
});

test('progress e remainingNow seguem o estado', () => {
  const running: FocusState = { status: 'running', kind: 'focus', durationMs: 10 * MIN, endsAt: 1_000 + 10 * MIN, remainingMs: 10 * MIN, task: null, cycleCount: 0, cycleEnabled: false, next: null };
  assert.equal(remainingNow(running, 1_000 + 4 * MIN), 6 * MIN);
  assert.equal(progress(running, 1_000 + 5 * MIN), 0.5);
  assert.equal(progress({ ...running, status: 'paused', endsAt: null, remainingMs: 3 * MIN }, 99_999_999), 0.7);
  assert.equal(progress({ ...running, status: 'finished', endsAt: null, remainingMs: 0 }, 0), 1);
  assert.equal(progress(IDLE_FOCUS_STATE, 0), 0);
  assert.equal(remainingNow(running, 1_000 + 99 * MIN), 0, 'nunca negativo');
});


const TASK = { id: '11111111-1111-4111-8111-111111111111', title: 'Escrever o relatório' };

function cycleSetup(cycle = true) {
  let t = 5_000_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  const finished: { kind: FocusKind; minutes: number; task: unknown }[] = [];
  const timer = new FocusTimer({
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    config: { ...DEFAULT_FOCUS_CONFIG, cycle, focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 },
    onFinished: (kind, s) => finished.push({ kind, minutes: s.minutes, task: s.task }),
  });
  const run = (kind: 'focus' | 'break', minutes: number, task?: unknown) => {
    assert.ok(timer.start(kind, minutes, task).ok);
    t += minutes * MIN;
    for (const [id, tm] of [...timers]) {
      if (tm.at <= t) {
        timers.delete(id);
        tm.fn();
      }
    }
  };
  return { timer, finished, run };
}

test('tempo livre: qualquer minuto inteiro entre 1 e 180 (foco) e 1 e 60 (pausa) é aceito', () => {
  for (const m of [1, 7, 37, 50, 90, 180]) assert.ok(validateSession('focus', m).ok, `foco ${m}`);
  for (const m of [1, 12, 60]) assert.ok(validateSession('break', m).ok, `pausa ${m}`);
  for (const m of [0, 181, 2.5, -1, NaN]) assert.ok(!validateSession('focus', m).ok, `foco ${m}`);
  const s = setup();
  assert.ok(s.timer.start('focus', 37).ok);
  assert.equal(s.timer.getState().durationMs, 37 * MIN);
});

test('tarefa vinculada: guardada na sessão, só para foco; id inválido é recusado', () => {
  const s = setup();
  assert.ok(s.timer.start('focus', 25, TASK).ok);
  assert.deepEqual(s.timer.getState().task, TASK);
  s.timer.cancel();
  assert.equal(s.timer.getState().task, null);
  assert.ok(s.timer.start('break', 5, TASK).ok);
  assert.equal(s.timer.getState().task, null, 'pausa não leva tarefa');
  s.timer.cancel();
  const bad = s.timer.start('focus', 25, { id: 'x', title: 'y' });
  assert.ok(!bad.ok && bad.error.code === 'invalid_task');
  assert.equal(s.timer.getState().status, 'idle');
  assert.deepEqual(validateFocusTask(undefined), { ok: true, value: null });
  const long = validateFocusTask({ id: TASK.id, title: ' ' + 'a'.repeat(500) });
  assert.ok(long.ok && long.value!.title.length === 200);
});

test('sessão concluída informa minutos e tarefa (para o registro do dia)', () => {
  const c = cycleSetup(false);
  c.run('focus', 30, TASK);
  assert.deepEqual(c.finished, [{ kind: 'focus', minutes: 30, task: TASK }]);
});

test('ciclo desligado: depois do foco sugere a pausa curta; depois da pausa, o foco padrão', () => {
  const c = cycleSetup(false);
  c.run('focus', 25);
  const st = c.timer.getState();
  assert.equal(st.cycleCount, 0, 'sem ciclo não conta');
  assert.deepEqual(st.next, { kind: 'break', minutes: 5, long: false });
  c.timer.cancel();
  c.run('break', 5);
  assert.deepEqual(c.timer.getState().next, { kind: 'focus', minutes: 25, long: false });
});

test('ciclo Pomodoro: 3 focos → pausas curtas; o 4º → pausa longa; ela zera o ciclo', () => {
  const c = cycleSetup(true);
  for (let i = 1; i <= 3; i++) {
    c.run('focus', 25);
    assert.equal(c.timer.getState().cycleCount, i);
    assert.deepEqual(c.timer.getState().next, { kind: 'break', minutes: 5, long: false });
    c.timer.cancel();
    c.run('break', 5);
    c.timer.cancel();
  }
  c.run('focus', 25);
  assert.equal(c.timer.getState().cycleCount, 4);
  assert.deepEqual(c.timer.getState().next, { kind: 'break', minutes: 15, long: true });
  c.timer.cancel();
  assert.equal(c.timer.getState().cycleCount, 4, 'dispensar não perde a contagem');
  c.run('break', 15);
  assert.equal(c.timer.getState().cycleCount, 0, 'a pausa longa fecha o ciclo');
  assert.deepEqual(c.timer.getState().next, { kind: 'focus', minutes: 25, long: false });
});

test('cancelar um foco no meio não conta no ciclo', () => {
  const c = cycleSetup(true);
  assert.ok(c.timer.start('focus', 25).ok);
  c.timer.cancel();
  assert.equal(c.timer.getState().cycleCount, 0);
});

test('configure: ligar/desligar o ciclo e mudar durações vale para a próxima sessão', () => {
  const c = cycleSetup(false);
  c.timer.configure({ ...DEFAULT_FOCUS_CONFIG, cycle: true, focusMinutes: 40, breakMinutes: 8, longBreakMinutes: 20 });
  assert.equal(c.timer.getState().cycleEnabled, true);
  assert.equal(c.timer.getState().durationMs, 40 * MIN, 'repouso mostra a duração padrão nova');
  c.run('focus', 40);
  assert.deepEqual(c.timer.getState().next, { kind: 'break', minutes: 8, long: false });
  c.timer.configure({ ...DEFAULT_FOCUS_CONFIG, cycle: false });
  assert.equal(c.timer.getState().cycleCount, 0);
  assert.equal(c.timer.getState().cycleEnabled, false);
});

test('nextStep: função pura', () => {
  const cfg = { ...DEFAULT_FOCUS_CONFIG, cycle: true };
  assert.deepEqual(nextStep('focus', 2, cfg), { kind: 'break', minutes: 5, long: false });
  assert.deepEqual(nextStep('focus', 4, cfg), { kind: 'break', minutes: 15, long: true });
  assert.deepEqual(nextStep('focus', 4, { ...cfg, cycle: false }), { kind: 'break', minutes: 5, long: false });
  assert.deepEqual(nextStep('break', 0, cfg), { kind: 'focus', minutes: 25, long: false });
});