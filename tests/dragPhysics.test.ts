import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearTurns,
  initialPhysics,
  isDizzy,
  isSettled,
  PHYSICS,
  recentTurns,
  stepPhysics,
  wrapAngle,
  type PhysicsState,
} from '../src/features/mascot/dragPhysics.ts';

const DT = 1 / 60;

/** Simula `seconds` com aceleração dada por `ax(t)`. */
function run(ax: (t: number) => number, seconds: number, start: PhysicsState = initialPhysics()) {
  let s = start;
  let t = 0;
  let peak = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    s = stepPhysics(s, ax(t), DT, t);
    peak = Math.max(peak, Math.abs(s.angle));
  }
  return { s, t, peak };
}

test('parado: sem aceleração o ângulo continua zero e o estado é "assentado"', () => {
  const { s } = run(() => 0, 2);
  assert.equal(s.angle, 0);
  assert.ok(isSettled(s));
});

test('movimento suave: inclina na direção do movimento e volta ao centro ao parar', () => {
  const right = run((t) => (t < 0.4 ? 4000 : 0), 0.4);
  assert.ok(right.s.angle > 3, `inclinou para a direita: ${right.s.angle}`);
  const left = run((t) => (t < 0.4 ? -4000 : 0), 0.4);
  assert.ok(left.s.angle < -3, `inclinou para a esquerda: ${left.s.angle}`);
  const rest = run(() => 0, 3, right.s);
  assert.ok(Math.abs(rest.s.angle) < 0.5, 'a mola o traz de volta');
  assert.ok(!rest.s.spinning);
});

test('movimento normal nunca vira giro nem passa do limite suave', () => {
  // Vai e volta devagar (~0,5 Hz, aceleração moderada), como arrastar com calma.
  const { peak, s } = run((t) => 5000 * Math.sin(2 * Math.PI * 0.5 * t), 6);
  assert.ok(peak <= PHYSICS.softLimit + 0.01, `pico ${peak}`);
  assert.ok(!s.spinning);
  assert.equal(recentTurns(s, 6), 0);
});

test('puxão muito forte vira giro (sem mola) e perde velocidade sozinho', () => {
  const kick = run((t) => (t < 0.12 ? 60000 : 0), 0.2);
  assert.ok(kick.s.spinning, 'girando');
  const later = run(() => 0, 6, kick.s);
  assert.ok(!later.s.spinning, 'o giro acaba');
  assert.ok(Math.abs(later.s.angle) < 1, 'e ele volta a ficar de pé');
  assert.ok(isSettled(later.s));
});

test('sacudir em ritmo ~2 Hz (ressonância) acaba girando', () => {
  const { s, peak } = run((t) => 14000 * Math.sin(2 * Math.PI * 1.8 * t), 4);
  assert.ok(peak > PHYSICS.softLimit, `passou do limite: ${peak}`);
  assert.ok(s.spinning || peak > 180, 'entrou em giro');
});

test('enjoo: duas voltas em 3 s disparam; poucas voltas ou espaçadas, não', () => {
  const spin = run((t) => (t < 0.15 ? 120000 : 0), 2.5);
  // Uma pancada forte dá várias voltas antes do atrito vencer.
  const turns = recentTurns(spin.s, spin.t);
  assert.ok(turns > 0.5, `voltas: ${turns}`);
  const manual: PhysicsState = { ...initialPhysics(), spinning: true, turns: [{ t: 1, amount: 1.1 }, { t: 2, amount: 1.0 }] };
  assert.ok(isDizzy(manual, 2.5));
  assert.ok(!isDizzy({ ...manual, turns: [{ t: 0, amount: 1.1 }, { t: 2.9, amount: 0.5 }] }, 3.5), 'fora da janela');
  assert.ok(!isDizzy({ ...manual, turns: [{ t: 2, amount: 0.9 }] }, 2.5));
  assert.equal(recentTurns(clearTurns(manual), 2.5), 0);
});

test('wrapAngle normaliza para [-180, 180)', () => {
  assert.equal(wrapAngle(190), -170);
  assert.equal(wrapAngle(-190), 170);
  assert.equal(wrapAngle(720), 0);
  assert.equal(wrapAngle(0), 0);
});

test('estabilidade numérica: passos grandes são limitados e nunca produzem NaN', () => {
  let s = initialPhysics();
  for (let i = 0; i < 200; i++) s = stepPhysics(s, 1e7 * (i % 2 ? 1 : -1), 0.5, i);
  assert.ok(Number.isFinite(s.angle) && Number.isFinite(s.omega));
  assert.ok(Math.abs(s.omega) <= PHYSICS.maxOmega);
});
