import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDuration, SOUND_LIMITS, SOUNDS, voicePlan, type SoundName } from '../src/features/audio/sounds.ts';

const names = Object.keys(SOUNDS) as SoundName[];

test('todo som é curto, baixo e dentro da faixa agradável (nada que irrite)', () => {
  for (const name of names) {
    const notes = SOUNDS[name];
    assert.ok(notes.length > 0, `${name}: vazio`);
    assert.ok(planDuration(notes) <= SOUND_LIMITS.maxDuration, `${name}: longo demais`);
    for (const n of notes) {
      assert.ok(n.gain > 0 && n.gain <= SOUND_LIMITS.maxGain, `${name}: volume ${n.gain}`);
      assert.ok(n.freq >= SOUND_LIMITS.minFreq && n.freq <= SOUND_LIMITS.maxFreq, `${name}: ${n.freq} Hz`);
      assert.ok(n.dur > 0 && n.at >= 0, `${name}: tempo inválido`);
    }
  }
});

test('o fim de foco é mais "rico" que o tec simples, e o tec é o mais curto', () => {
  assert.ok(SOUNDS.focusDone.length > SOUNDS.taskDone.length);
  assert.ok(planDuration(SOUNDS.tick) < planDuration(SOUNDS.focusDone));
});

/** Gerador pseudoaleatório determinístico (xorshift). */
function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

test('voz: de 3 a 9 bips, proporcional ao tamanho da frase, sem repetir a mesma nota em seguida', () => {
  const short = voicePlan('Oi!', seeded(1));
  const long = voicePlan('Já é tarde... bora descansar um pouquinho agora?', seeded(1));
  assert.equal(short.length, 3);
  assert.ok(long.length > short.length && long.length <= 9);
  for (const plan of [short, long]) {
    for (let i = 1; i < plan.length; i++) assert.notEqual(plan[i].freq, plan[i - 1].freq);
  }
});

test('voz: bips curtos e baixos; duração total limitada mesmo para frases enormes', () => {
  const plan = voicePlan('a'.repeat(500), seeded(7));
  assert.equal(plan.length, 9);
  assert.ok(planDuration(plan) < 1);
  for (const n of plan) {
    assert.ok(n.gain <= 0.35);
    assert.ok(n.freq >= 600 && n.freq <= 1300);
  }
});

test('voz: texto sem letras (só símbolos) ainda produz o mínimo de bips', () => {
  assert.equal(voicePlan('...!!!', seeded(3)).length, 3);
  assert.equal(voicePlan('', seeded(3)).length, 3);
});
