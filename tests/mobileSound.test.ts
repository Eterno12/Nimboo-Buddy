import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SOUND_PREFS, parseSoundPrefs } from '../mobile/src/soundPrefs.ts';

test('parseSoundPrefs: padrão ligado a 40%, valores limitados e passos de 5%', () => {
  assert.deepEqual(parseSoundPrefs(null), DEFAULT_SOUND_PREFS);
  assert.deepEqual(parseSoundPrefs('lixo{'), DEFAULT_SOUND_PREFS);
  assert.deepEqual(parseSoundPrefs('{"enabled":false,"volume":0.73}'), { enabled: false, volume: 0.75 });
  assert.equal(parseSoundPrefs('{"volume":9}').volume, 1);
  assert.equal(parseSoundPrefs('{"volume":-3}').volume, 0);
  assert.equal(parseSoundPrefs('{"enabled":"sim"}').enabled, true);
});
