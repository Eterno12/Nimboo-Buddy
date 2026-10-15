import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, parseProfile, serializeProfile } from '../mobile/src/profile.ts';

test('perfil: ida e volta e valores inválidos voltam ao padrão', () => {
  const p = { character: 'cactus', color: 'sky', name: 'Espinho', skin: 'cactus.bandana' } as const;
  assert.deepEqual(parseProfile(serializeProfile(p)), p);
  assert.deepEqual(parseProfile(null), DEFAULT_PROFILE);
  assert.deepEqual(parseProfile('{lixo'), DEFAULT_PROFILE);
  assert.deepEqual(parseProfile(JSON.stringify({ character: '__proto__', color: 'preto', name: '   ' })), DEFAULT_PROFILE);
  assert.equal(parseProfile(JSON.stringify({ name: 'x'.repeat(25) })).name, 'Nimboo');
});
