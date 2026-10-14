import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commitNudge,
  dueNudge,
  initWellness,
  MIN_GAP_MS,
  restartKind,
  WELLNESS_INTERVALS,
  WELLNESS_TEXT,
  type WellnessConfig,
} from '../shared/wellness.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../shared/settings.ts';

const MIN = 60_000;
const cfg = (patch: Partial<WellnessConfig> = {}): WellnessConfig => ({
  water: { on: false, minutes: 60 },
  posture: { on: false, minutes: 45 },
  eyes: { on: false, minutes: 20 },
  ...patch,
});

test('bem-estar: tudo desligado nunca lembra', () => {
  const s = initWellness(0);
  assert.equal(dueNudge(s, cfg(), 10 * 60 * MIN, false), null);
});

test('bem-estar: lembra só depois do intervalo e nunca com bloqueio (foco)', () => {
  const s = initWellness(0);
  const c = cfg({ eyes: { on: true, minutes: 20 } });
  assert.equal(dueNudge(s, c, 19 * MIN, false), null);
  assert.equal(dueNudge(s, c, 20 * MIN, true), null);
  assert.equal(dueNudge(s, c, 20 * MIN, false)?.kind, 'eyes');
  // o vencimento não se perde: ao desbloquear, lembra
  assert.equal(dueNudge(s, c, 50 * MIN, false)?.kind, 'eyes');
});

test('bem-estar: confirmar reinicia a contagem e respeita o intervalo mínimo entre lembretes', () => {
  let s = initWellness(0);
  const c = cfg({ water: { on: true, minutes: 30 }, eyes: { on: true, minutes: 30 } });
  const first = dueNudge(s, c, 30 * MIN, false);
  assert.ok(first);
  s = commitNudge(s, first.kind, 30 * MIN);
  // o outro venceu junto, mas só sai depois do intervalo mínimo
  assert.equal(dueNudge(s, c, 30 * MIN + MIN_GAP_MS - 1, false), null);
  const second = dueNudge(s, c, 30 * MIN + MIN_GAP_MS, false);
  assert.ok(second && second.kind !== first.kind);
  s = commitNudge(s, second.kind, 30 * MIN + MIN_GAP_MS);
  assert.equal(dueNudge(s, c, 31 * MIN, false), null);
});

test('bem-estar: o mais atrasado vem primeiro e as frases giram', () => {
  let s = initWellness(0);
  const c = cfg({ water: { on: true, minutes: 60 }, posture: { on: true, minutes: 20 } });
  assert.equal(dueNudge(s, c, 70 * MIN, false)?.kind, 'posture'); // 50 min de atraso x 10
  const seen = new Set<string>();
  for (let i = 0; i < WELLNESS_TEXT.water.length; i++) {
    const n = dueNudge(s, cfg({ water: { on: true, minutes: 30 } }), s.last.water + 30 * MIN + (i + 1) * 0, false);
    assert.ok(n);
    seen.add(n.text);
    s = commitNudge(s, 'water', s.last.water + 30 * MIN);
  }
  assert.equal(seen.size, WELLNESS_TEXT.water.length);
});

test('bem-estar: reiniciar um tipo adia o vencimento; falas cabem no balão', () => {
  let s = initWellness(0);
  const c = cfg({ water: { on: true, minutes: 30 } });
  s = restartKind(s, 'water', 25 * MIN);
  assert.equal(dueNudge(s, c, 30 * MIN, false), null);
  assert.equal(dueNudge(s, c, 55 * MIN, false)?.kind, 'water');
  for (const list of Object.values(WELLNESS_TEXT)) for (const t of list) assert.ok(t.length <= 56, t);
});

test('preferências de bem-estar: padrão desligado e intervalos validados', () => {
  assert.equal(DEFAULT_SETTINGS.wellnessWater, false);
  assert.equal(DEFAULT_SETTINGS.wellnessPosture, false);
  assert.equal(DEFAULT_SETTINGS.wellnessEyes, false);
  assert.equal(DEFAULT_SETTINGS.wellnessStretch, false);
  const p = parseSettings({ version: 3, wellnessWater: true, wellnessWaterMin: 47, wellnessEyesMin: 'x', wellnessPostureMin: 1000, wellnessStretch: 1 });
  assert.equal(p.wellnessWater, true);
  assert.ok(WELLNESS_INTERVALS.water.includes(p.wellnessWaterMin));
  assert.equal(p.wellnessWaterMin, 45);
  assert.equal(p.wellnessEyesMin, DEFAULT_SETTINGS.wellnessEyesMin);
  assert.equal(p.wellnessPostureMin, 60);
  assert.equal(p.wellnessStretch, false);
});
