import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePairing, parsePairing, PAIRING_TTL_MS } from '../shared/sync/pairing.ts';

const URL = 'https://abcdefghijklmnopqrst.supabase.co';
const HASH = 'a'.repeat(64);

test('pairing: o que o QR leva volta igual e só vale para este projeto', () => {
  const text = encodePairing({ url: URL, tokenHash: HASH, now: 1_000_000 });
  const r = parsePairing(text, { url: URL, now: 1_000_000 + 1000 });
  assert.deepEqual(r, { ok: true, tokenHash: HASH });
});

test('pairing: expira em 2 minutos (com 30 s de tolerância de relógio)', () => {
  const text = encodePairing({ url: URL, tokenHash: HASH, now: 1_000_000 });
  const late = parsePairing(text, { url: URL, now: 1_000_000 + PAIRING_TTL_MS + 31_000 });
  assert.equal(late.ok, false);
  assert.match((late as { message: string }).message, /expirou/i);
});

test('pairing: recusa projeto diferente, lixo e hash malformado', () => {
  const text = encodePairing({ url: 'https://outroprojetoaaaaaaaaaa.supabase.co', tokenHash: HASH, now: 5 });
  assert.equal(parsePairing(text, { url: URL, now: 6 }).ok, false);
  for (const bad of ['', 'oi', 'https://evil.example/?h=' + HASH, 'nimboo://pair?v=1&h=curto&x=9&p=abc', 'nimboo://pair?v=9&h=' + HASH]) {
    assert.equal(parsePairing(bad, { url: URL, now: 6 }).ok, false, bad);
  }
});
