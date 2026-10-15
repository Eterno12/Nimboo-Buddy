import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { SyncStore } from '../electron/sync/syncStore.ts';
import { parseProfileData, profileEquals, serializeProfileData, type ProfileData } from '../shared/sync/profile.ts';

const P: ProfileData = { character: 'cactus', color: 'sky', name: 'Espinho', skin: 'cactus.escuros' };

test('perfil: serializa e valida (personagem, cor, nome e acessório do personagem)', () => {
  assert.deepEqual(parseProfileData(serializeProfileData(P)), P);
  assert.equal(parseProfileData('{lixo'), null);
  assert.equal(parseProfileData(JSON.stringify({ character: 'x', color: 'sky', name: 'a', skin: null })), null);
  assert.equal(parseProfileData(JSON.stringify({ ...P, skin: 'ghost.festa' }))?.skin, null, 'acessório de outro personagem não vale');
  assert.equal(parseProfileData(JSON.stringify({ ...P, name: '' })), null);
  assert.equal(profileEquals(P, { ...P }), true);
  assert.equal(profileEquals(P, { ...P, color: 'rose' }), false);
});

test('SyncStore: gravar o perfil enfileira uma vez e repetir o mesmo valor não faz nada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimboo-prof-'));
  const db = openDatabase(path.join(dir, 'mochi.db'));
  try {
    const store = new SyncStore(db);
    assert.equal(store.getProfile(), null);
    assert.equal(store.putProfile(P, '2026-10-15T10:00:00.000Z'), true);
    assert.deepEqual(store.getProfile()?.profile, P);
    assert.equal(store.pending().filter((p) => p.tbl === 'profile').length, 1);
    store.ack(store.pending().at(-1)!.seq);
    assert.equal(store.putProfile({ ...P }, '2026-10-15T11:00:00.000Z'), false, 'igual: não regrava');
    assert.equal(store.pending().length, 0);
    assert.equal(store.putProfile({ ...P, color: 'rose' }, '2026-10-15T12:00:00.000Z'), true);
    assert.equal(store.pending().length, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
