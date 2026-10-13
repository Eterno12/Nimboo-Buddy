import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_LABELS,
  CHARACTERS,
  DEFAULT_CHARACTER,
  DEFAULT_SETTINGS,
  parseSettings,
} from '../shared/settings.ts';
import { CHARACTER_REGISTRY, NEUTRAL_TRAITS, characterInfo } from '../src/features/mascot/characters.ts';
import {
  NEUTRAL_PROFILE,
  SOUNDS,
  SOUND_LIMITS,
  applyProfile,
  planDuration,
  voicePlan,
  type SoundName,
} from '../src/features/audio/sounds.ts';
import { LINES, createPersonality } from '../src/features/personality/personality.ts';

// O controlador usa `window.setTimeout` etc.; em Node, `window` é o próprio global (com timers falsos).
(globalThis as unknown as { window: unknown }).window = globalThis;
const { createMascotController } = await import('../src/features/mascot/mascotController.ts');
const S = await import('../src/features/mascot/mascotStates.ts');

const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

test('registro: um personagem por id, rótulos únicos vindos da fonte compartilhada, Mochi é o padrão', () => {
  assert.equal(DEFAULT_CHARACTER, 'mochi');
  assert.equal(DEFAULT_SETTINGS.character, 'mochi');
  assert.deepEqual(Object.keys(CHARACTER_REGISTRY).sort(), [...CHARACTERS].sort());
  const labels = CHARACTERS.map((id) => CHARACTER_REGISTRY[id].label);
  assert.equal(new Set(labels).size, CHARACTERS.length, 'rótulos únicos');
  for (const id of CHARACTERS) {
    const info = CHARACTER_REGISTRY[id];
    assert.equal(info.id, id);
    assert.equal(info.label, CHARACTER_LABELS[id]);
    assert.ok(info.tagline.length > 0 && info.tagline.length <= 40, `${id}: descrição curta`);
  }
});

test('ajustes de rosto e ritmos ficam em faixas seguras (nada some, nada frenético)', () => {
  for (const id of CHARACTERS) {
    const { face, traits } = CHARACTER_REGISTRY[id];
    assert.ok(face.scale >= 0.8 && face.scale <= 1.05, `${id} escala do rosto ${face.scale}`);
    assert.ok(Math.abs(face.dx) <= 10 && face.dy >= -10 && face.dy <= 30, `${id} posição do rosto`);
    assert.ok(traits.ambientPace >= 0.6 && traits.ambientPace <= 1.5, `${id} ambientPace`);
    assert.ok(traits.sleepAfter >= 0.6 && traits.sleepAfter <= 1.8, `${id} sleepAfter`);
    assert.ok(traits.blinkPace >= 0.7 && traits.blinkPace <= 1.3, `${id} blinkPace`);
    assert.ok(traits.curiosity >= 0 && traits.curiosity <= 0.3, `${id} curiosity`);
  }
  assert.deepEqual(CHARACTER_REGISTRY.mochi.traits, NEUTRAL_TRAITS, 'o original mantém o comportamento de sempre');
  assert.deepEqual(CHARACTER_REGISTRY.mochi.face, { dx: 0, dy: 0, scale: 1 });
  assert.deepEqual(CHARACTER_REGISTRY.mochi.sound, NEUTRAL_PROFILE);
});

test('characterInfo: id desconhecido, vazio ou de tipo errado cai no original', () => {
  assert.equal(characterInfo('ghost').id, 'ghost');
  for (const bad of ['dragon', '', null, undefined, '__proto__', 'constructor', 'toString']) {
    assert.equal(characterInfo(bad as string | null | undefined).id, 'mochi', String(bad));
  }
});

test('configurações: personagem válido é mantido; inválido, tipo errado ou versão antiga viram o Mochi', () => {
  assert.equal(parseSettings({ version: 3, character: 'cactus' }).character, 'cactus');
  for (const id of CHARACTERS) assert.equal(parseSettings({ version: 3, character: id }).character, id);
  for (const bad of ['dragon', 7, null, {}, [], true, 'MOCHI', ' ghost']) {
    assert.equal(parseSettings({ version: 3, character: bad }).character, 'mochi', JSON.stringify(bad));
  }
  assert.equal(parseSettings({ version: 2, character: 'ghost', color: 'rose' }).character, 'mochi');
  assert.equal(parseSettings({ version: 1 }).character, 'mochi');
  assert.equal(parseSettings(null).character, 'mochi');
  assert.equal(parseSettings('ghost').character, 'mochi');
});

test('som: todo som de todo personagem respeita os limites (frequência, volume, duração)', () => {
  for (const id of CHARACTERS) {
    const profile = CHARACTER_REGISTRY[id].sound;
    const plans = [
      ...SOUND_NAMES.map((n) => applyProfile(SOUNDS[n], profile)),
      voicePlan('Uma frase um pouco mais longa para o balão falar', () => 0.5, profile),
      voicePlan('Oi', () => 0.99, profile),
    ];
    for (const notes of plans) {
      assert.ok(notes.length > 0, `${id}: plano vazio`);
      for (const n of notes) {
        assert.ok(n.freq >= SOUND_LIMITS.minFreq && n.freq <= SOUND_LIMITS.maxFreq, `${id} freq ${n.freq}`);
        if (n.glideTo !== undefined) {
          assert.ok(n.glideTo >= SOUND_LIMITS.minFreq && n.glideTo <= SOUND_LIMITS.maxFreq, `${id} glide ${n.glideTo}`);
        }
        assert.ok(n.gain > 0 && n.gain <= SOUND_LIMITS.maxGain, `${id} ganho ${n.gain}`);
        assert.ok(n.dur > 0 && n.at >= 0, `${id} tempos`);
      }
      assert.ok(planDuration(notes) <= SOUND_LIMITS.maxDuration + 1e-9, `${id} duração ${planDuration(notes)}`);
    }
  }
});

test('som: o perfil neutro não altera nada e cada personagem tem uma assinatura própria', () => {
  for (const n of SOUND_NAMES) {
    const same = applyProfile(SOUNDS[n], NEUTRAL_PROFILE);
    assert.deepEqual(
      same.map((x) => [x.at, x.freq, x.dur, x.gain, x.wave, x.glideTo]),
      SOUNDS[n].map((x) => [x.at, x.freq, x.dur, x.gain, x.wave, x.glideTo]),
      `neutro mantém ${n}`,
    );
  }
  // "Assinatura": o som mais característico (carinho) e a voz do balão diferem entre TODOS os personagens.
  const finger = (id: (typeof CHARACTERS)[number], name: SoundName) =>
    JSON.stringify(applyProfile(SOUNDS[name], CHARACTER_REGISTRY[id].sound));
  for (const name of ['happy', 'surprised', 'yawn', 'grabbed'] as const) {
    const all = CHARACTERS.map((id) => finger(id, name));
    assert.equal(new Set(all).size, CHARACTERS.length, `${name}: um timbre por personagem`);
  }
  const voices = CHARACTERS.map((id) => JSON.stringify(voicePlan('Bom dia, tudo bem?', () => 0.3, CHARACTER_REGISTRY[id].sound)));
  assert.equal(new Set(voices).size, CHARACTERS.length, 'voz do balão distinta');
});

test('som: efeitos do perfil (altura, duração, camada, vibrato, clique) aparecem no plano', () => {
  const base = SOUNDS.happy;
  const high = applyProfile(base, { ...NEUTRAL_PROFILE, pitch: 1.2 });
  assert.ok(high[0].freq > base[0].freq);
  const slow = applyProfile(base, { ...NEUTRAL_PROFILE, durationScale: 1.5 });
  assert.ok(planDuration(slow) > planDuration(base));
  const layered = applyProfile(base, { ...NEUTRAL_PROFILE, layer: { ratio: 2, gain: 0.4 } });
  assert.equal(layered.length, base.length * 2);
  const vib = applyProfile(base, { ...NEUTRAL_PROFILE, vibrato: 20 });
  assert.ok(vib.every((n) => n.vibrato === 20));
  const click = applyProfile(base, { ...NEUTRAL_PROFILE, click: true });
  assert.equal(click.length, base.length + 1);
  // extremos: nunca passa dos limites
  const wild = applyProfile(base, { ...NEUTRAL_PROFILE, pitch: 9, durationScale: 9, gainScale: 9 });
  assert.ok(wild.every((n) => n.freq <= SOUND_LIMITS.maxFreq && n.gain <= SOUND_LIMITS.maxGain));
  assert.ok(planDuration(wild) <= SOUND_LIMITS.maxDuration + 1e-9);
});

test('personalidade: as frases do personagem entram no sorteio e respeitam o espaçamento de sempre', () => {
  const extra = { idle: ['Frase do abacaxi'] };
  const ctx = { now: new Date('2026-03-04T15:00:00'), mood: 'mid' as const, focusActive: false, extra };
  // random ≈ 1 escolhe o último candidato: a frase extra vem depois das frases-base
  const p = createPersonality(() => 0.999);
  assert.equal(p.pick('idle', ctx), 'Frase do abacaxi');
  // intervalo geral: outra fala logo em seguida é recusada
  assert.equal(p.pick('hello', { ...ctx, now: new Date(ctx.now.getTime() + 1000) }), null);
  // sem frases extras, o conjunto continua sendo só o do Mochi
  const q = createPersonality(() => 0.999);
  const text = q.pick('idle', { now: ctx.now, mood: 'mid', focusActive: false });
  assert.ok(LINES.idle.some((l) => l.text === text));
  // durante o foco, continua em silêncio mesmo com frases extras
  const f = createPersonality(() => 0.5);
  assert.equal(f.pick('idle', { ...ctx, focusActive: true }), null);
});

test('registro: as frases dos personagens são curtas (cabem no balão) e sem duplicatas', () => {
  for (const id of CHARACTERS) {
    const { idle, hello } = CHARACTER_REGISTRY[id].lines;
    for (const text of [...idle, ...hello]) assert.ok(text.length <= 38, `${id}: "${text}" (${text.length})`);
    assert.equal(new Set([...idle, ...hello]).size, idle.length + hello.length, `${id}: sem repetidas`);
  }
});

// ---- Controlador: ritmos por personagem ----

let snap: import('../src/features/mascot/mascotController.ts').MascotSnapshot;
let c: import('../src/features/mascot/mascotController.ts').MascotController;

beforeEach(() => {
  mock.method(Math, 'random', () => 0.1); // espontâneos viram só um pulinho (determinístico)
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  snap = { state: 'idle', replay: 0, hop: false, blinking: false, mood: 'mid' };
  c = createMascotController((s) => {
    snap = s;
  });
});

afterEach(() => {
  c.dispose();
  mock.timers.reset();
  mock.restoreAll();
});

test('controlador: personagem sonolento dorme antes; paciente (abacaxi) dorme depois', () => {
  c.setTraits({ ...NEUTRAL_TRAITS, sleepAfter: 0.5 });
  c.start();
  mock.timers.tick(S.SLEEP_AFTER_MS * 0.5 + 50);
  assert.equal(snap.state, 'yawn', 'bocejou na metade do tempo');
  c.dispose();

  // mesma coisa com o ritmo lento: na metade do tempo normal ainda não bocejou
  snap = { state: 'idle', replay: 0, hop: false, blinking: false, mood: 'mid' };
  c = createMascotController((s) => {
    snap = s;
  });
  c.setTraits({ ...NEUTRAL_TRAITS, sleepAfter: 1.6 });
  c.start();
  mock.timers.tick(S.SLEEP_AFTER_MS * 1.2);
  assert.equal(snap.state, 'idle');
  mock.timers.tick(S.SLEEP_AFTER_MS * 0.5);
  assert.equal(snap.state, 'yawn');
});

test('controlador: trocar de personagem com o app aberto não reinicia a máquina nem muda o estado', () => {
  c.start();
  c.pet();
  assert.equal(snap.state, 'happy');
  const replay = snap.replay;
  c.setTraits(CHARACTER_REGISTRY.ghost.traits);
  assert.equal(snap.state, 'happy', 'a troca não interrompe a animação em curso');
  assert.equal(snap.replay, replay);
  mock.timers.tick(S.STATE_DURATION_MS.happy! + 10);
  assert.equal(snap.state, 'idle');
});

test('controlador: todos os personagens respondem aos mesmos eventos (carinho, segurar, soltar)', () => {
  for (const id of CHARACTERS) {
    c.dispose();
    snap = { state: 'idle', replay: 0, hop: false, blinking: false, mood: 'mid' };
    c = createMascotController((s) => {
      snap = s;
    });
    c.setTraits(CHARACTER_REGISTRY[id].traits);
    c.start();
    c.pet();
    assert.equal(snap.state, 'happy', `${id} carinho`);
    c.grab();
    assert.equal(snap.state, 'grabbed', `${id} segurar`);
    c.release();
    assert.equal(snap.state, 'idle', `${id} soltar`);
  }
});
