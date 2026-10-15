import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { SqlJsModule } from '../mobile/db/sqlJsDatabase.ts';
import type { BlobStore } from '../mobile/db/persistence.ts';
import { createCore } from '../mobile/src/core.ts';
import { DEFAULT_PROFILE, parseProfile, serializeProfile } from '../mobile/src/profile.ts';

const initSqlJs = createRequire(import.meta.url)('sql.js') as () => Promise<SqlJsModule>;

const blob = (): BlobStore => {
  let bytes: Uint8Array | null = null;
  return { read: async () => bytes, write: async (b) => void (bytes = new Uint8Array(b)) };
};

async function open() {
  return createCore({
    SQL: await initSqlJs(),
    blob: blob(),
    session: { read: () => null, write: () => {}, clear: () => {} },
    fetch: async () => {
      throw new Error('sem rede');
    },
    url: 'http://127.0.0.1:1',
    anonKey: 'x',
    debounceMs: 5,
  });
}

test('conquistas: concluir tarefa, criar nota e foco alimentam o vínculo; pontos viram saldo', async () => {
  const core = await open();
  const before = core.bond.snapshot();
  assert.equal(before.achievements.find((a) => a.id === 'first_task')?.unlocked, false);

  const t = await core.tasks.create('Primeira');
  assert.ok(t.ok);
  await core.tasks.complete(t.ok ? t.value.id : '');
  await core.notes.create({});
  const after = core.bond.snapshot();
  assert.equal(after.achievements.find((a) => a.id === 'first_task')?.unlocked, true);
  assert.equal(after.achievements.find((a) => a.id === 'first_note')?.unlocked, true);
  assert.ok(after.points >= 20, `pontos ${after.points}`);
  assert.equal(after.balance, after.points);

  // Comprar um acessório gasta o saldo, não o total.
  const skin = after.points >= 20 ? 'mochi.laco' : '';
  const bought = core.bond.buySkin(skin);
  assert.ok(bought, 'comprou o laço (20 pts)');
  assert.equal(bought?.points, after.points);
  assert.equal(bought?.balance, after.points - 20);
  await core.close();
});

test('perfil: o acessório em uso só vale se for do personagem e existir', () => {
  const ok = parseProfile(serializeProfile({ ...DEFAULT_PROFILE, character: 'cactus', skin: 'cactus.escuros' }));
  assert.equal(ok.skin, 'cactus.escuros');
  const wrongChar = parseProfile(serializeProfile({ ...DEFAULT_PROFILE, character: 'mochi', skin: 'cactus.escuros' }));
  assert.equal(wrongChar.skin, null);
  assert.equal(parseProfile(JSON.stringify({ skin: '../x' })).skin, null);
  assert.equal(parseProfile(null).skin, null);
});
