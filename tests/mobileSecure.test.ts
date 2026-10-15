import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64, base64ToBytes } from '../mobile/src/platform/base64.ts';
import { encryptedSession, type KeyVault } from '../mobile/src/platform/secureSession.ts';

test('base64: ida e volta preserva bytes (inclusive arquivos grandes)', () => {
  const small = new Uint8Array([0, 1, 2, 250, 251, 255]);
  assert.deepEqual(base64ToBytes(bytesToBase64(small)), small);
  const big = new Uint8Array(300_000).map((_, i) => (i * 31) % 256);
  assert.deepEqual(base64ToBytes(bytesToBase64(big)), big);
});

/** Cofre de chave em memória (no app é o IndexedDB com chave não extraível). */
function memoryVault(): KeyVault & { key: CryptoKey | null } {
  const v = {
    key: null as CryptoKey | null,
    get: async () => v.key,
    set: async (k: CryptoKey) => void (v.key = k),
  };
  return v;
}

test('sessão: o que vai para o armazenamento é cifrado e volta igual', async () => {
  const raw = new Map<string, string>();
  const storage = {
    read: () => raw.get('s') ?? null,
    write: (v: string) => void raw.set('s', v),
    clear: () => void raw.delete('s'),
  };
  const vault = memoryVault();
  const secure = await encryptedSession(storage, vault);
  await secure.save('{"refreshToken":"ref-segredo-123"}');
  const stored = raw.get('s') as string;
  assert.ok(stored.length > 20);
  assert.ok(!stored.includes('ref-segredo-123'), 'o token estava em texto simples');
  assert.equal(await secure.load(), '{"refreshToken":"ref-segredo-123"}');

  // Conteúdo adulterado ou chave perdida: devolve null (a pessoa entra de novo), nunca lança.
  raw.set('s', stored.slice(0, -4) + 'AAAA');
  assert.equal(await secure.load(), null);
  const other = await encryptedSession({ ...storage, read: () => stored }, memoryVault());
  assert.equal(await other.load(), null);
});
