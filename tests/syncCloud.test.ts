import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseAuth, type SessionStorage } from '../electron/sync/supabaseAuth.ts';
import { SupabaseTransport, SyncAuthError } from '../electron/sync/supabaseTransport.ts';
import { encodePairing } from '../shared/sync/pairing.ts';

const URL_BASE = 'https://projeto.supabase.co';
const KEY = 'anon-key-publica';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** fetch falso: devolve as respostas na ordem e registra as chamadas. */
function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : null });
    const r = responses.shift() ?? { status: 500, body: { message: 'sem resposta' } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? null, text: async () => JSON.stringify(r.body ?? null) };
  };
  return { fn, calls };
}

function memoryStorage(): SessionStorage & { value: string | null } {
  const s = {
    value: null as string | null,
    read: () => s.value,
    write: (v: string) => void (s.value = v),
    clear: () => void (s.value = null),
  };
  return s;
}

const session = (expiresInS: number) => ({
  access_token: 'acc-1',
  refresh_token: 'ref-1',
  expires_in: expiresInS,
  user: { id: 'user-1', email: 'ana@exemplo.com' },
});

test('login: pede o código e confirma; a sessão é guardada e a chave anon vai nos cabeçalhos', async () => {
  const f = fakeFetch([{ status: 200, body: {} }, { status: 200, body: session(3600) }]);
  const storage = memoryStorage();
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage, now: () => 1_000_000 });

  assert.deepEqual(await auth.requestCode('Ana@Exemplo.com '), { ok: true });
  assert.equal(f.calls[0].url, `${URL_BASE}/auth/v1/otp`);
  assert.deepEqual(f.calls[0].body, { email: 'ana@exemplo.com', create_user: true });
  assert.equal(f.calls[0].headers.apikey, KEY);

  assert.deepEqual(await auth.verifyCode('ana@exemplo.com', '123456'), { ok: true });
  assert.equal(f.calls[1].url, `${URL_BASE}/auth/v1/verify`);
  assert.deepEqual(f.calls[1].body, { type: 'email', email: 'ana@exemplo.com', token: '123456' });
  assert.deepEqual(auth.account(), { email: 'ana@exemplo.com', userId: 'user-1' });
  assert.ok(storage.value?.includes('ref-1'), 'sessão guardada');
  assert.equal(await auth.accessToken(), 'acc-1');
});

test('login: e-mail e código inválidos são recusados sem chamar a rede', async () => {
  const f = fakeFetch([]);
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage: memoryStorage() });
  const a = await auth.requestCode('isso-nao-e-email');
  assert.equal(a.ok, false);
  const b = await auth.verifyCode('ana@exemplo.com', 'abc');
  assert.equal(b.ok, false);
  assert.equal(f.calls.length, 0);
});

test('login: erros do servidor viram mensagens claras (limite de envios, código errado, sem rede)', async () => {
  const f = fakeFetch([
    { status: 429, body: { msg: 'rate limit' } },
    { status: 400, body: { msg: 'Token has expired or is invalid' } },
  ]);
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage: memoryStorage() });
  const rate = await auth.requestCode('ana@exemplo.com');
  assert.ok(!rate.ok && /Muitas tentativas/.test(rate.message));
  const bad = await auth.verifyCode('ana@exemplo.com', '000000');
  assert.ok(!bad.ok && /código/i.test(bad.message));

  const offline = new SupabaseAuth({
    url: URL_BASE,
    anonKey: KEY,
    fetch: async () => {
      throw new Error('ENOTFOUND');
    },
    storage: memoryStorage(),
  });
  const r = await offline.requestCode('ana@exemplo.com');
  assert.ok(!r.ok && /conexão/i.test(r.message));
});

test('token perto de expirar é renovado uma vez; falha de renovação pede novo login e não apaga a sessão guardada de outro jeito', async () => {
  let t = 1_000_000;
  const f = fakeFetch([
    { status: 200, body: session(100) },
    { status: 200, body: { ...session(3600), access_token: 'acc-2', refresh_token: 'ref-2' } },
  ]);
  const storage = memoryStorage();
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage, now: () => t });
  await auth.verifyCode('ana@exemplo.com', '123456');
  assert.equal(await auth.accessToken(), 'acc-1', 'ainda válido por 100 s (> margem de 60 s)');

  t += 60_000; // faltam 40 s: renova
  assert.equal(await auth.accessToken(), 'acc-2');
  assert.equal(f.calls.at(-1)!.url, `${URL_BASE}/auth/v1/token?grant_type=refresh_token`);
  assert.deepEqual(f.calls.at(-1)!.body, { refresh_token: 'ref-1' });
  assert.ok(storage.value?.includes('ref-2'));

  // Renovação recusada: sessão some da memória e do disco (o refresh token já não vale).
  const g = fakeFetch([{ status: 200, body: session(10) }, { status: 400, body: { msg: 'Invalid Refresh Token' } }]);
  const a2 = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: g.fn, storage: memoryStorage(), now: () => t });
  await a2.verifyCode('ana@exemplo.com', '123456');
  await assert.rejects(() => a2.accessToken(), (e: unknown) => e instanceof SyncAuthError);
  assert.equal(a2.account(), null);
});

test('sair encerra no servidor (sem travar se a rede falhar) e limpa a sessão local', async () => {
  const f = fakeFetch([{ status: 200, body: session(3600) }, { status: 500 }]);
  const storage = memoryStorage();
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage, now: () => 1 });
  await auth.verifyCode('ana@exemplo.com', '123456');
  await auth.signOut();
  assert.equal(auth.account(), null);
  assert.equal(storage.value, null);
  assert.equal(f.calls.at(-1)!.url, `${URL_BASE}/auth/v1/logout`);
});

test('sessão guardada é restaurada ao abrir o app; arquivo corrompido é ignorado', async () => {
  const f = fakeFetch([{ status: 200, body: session(3600) }]);
  const storage = memoryStorage();
  const first = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage, now: () => 5 });
  await first.verifyCode('ana@exemplo.com', '123456');
  const second = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage, now: () => 5 });
  assert.deepEqual(second.account(), { email: 'ana@exemplo.com', userId: 'user-1' });
  storage.value = '{lixo';
  const third = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage, now: () => 5 });
  assert.equal(third.account(), null);
});

test('transporte: push e pull usam as funções do servidor com o token da pessoa', async () => {
  const f = fakeFetch([
    { status: 200, body: 42 },
    { status: 200, body: [{ tbl: 'tasks', id: 'a', payload: { title: 'x' }, stamp: 's', origin: 'o', deleted: false, server_seq: '7' }] },
    { status: 200, body: null },
  ]);
  const transport = new SupabaseTransport({ url: URL_BASE, anonKey: KEY, fetch: f.fn, token: async () => 'tok' });

  const seq = await transport.push([{ tbl: 'tasks', id: 'a', deleted: false, stamp: 's', origin: 'o', payload: { title: 'x' } }]);
  assert.equal(seq, 42);
  assert.equal(f.calls[0].url, `${URL_BASE}/rest/v1/rpc/sync_push`);
  assert.equal(f.calls[0].headers.Authorization, 'Bearer tok');
  assert.equal(f.calls[0].headers.apikey, KEY);

  const rows = await transport.pull(5, 100);
  assert.deepEqual(f.calls[1].body, { since: 5, max_rows: 100 });
  assert.equal(rows[0].server_seq, 7, 'bigint em texto vira número');

  await transport.wipe();
  assert.equal(f.calls[2].url, `${URL_BASE}/rest/v1/rpc/sync_wipe`);
});

test('transporte: 401 vira erro de login; outros erros viram mensagem sem vazar o token', async () => {
  const f = fakeFetch([{ status: 401, body: { message: 'JWT expired' } }, { status: 503, body: { message: 'indisponível' } }]);
  const transport = new SupabaseTransport({ url: URL_BASE, anonKey: KEY, fetch: f.fn, token: async () => 'segredo-tok' });
  await assert.rejects(() => transport.pull(0, 10), (e: unknown) => e instanceof SyncAuthError);
  await assert.rejects(
    () => transport.pull(0, 10),
    (e: unknown) => e instanceof Error && !(e instanceof SyncAuthError) && !e.message.includes('segredo-tok'),
  );
});

const HASH64 = 'f'.repeat(64);

test('QR: o PC pede o token de uso único à função "pair" com o token da sessão e monta o QR', async () => {
  const f = fakeFetch([{ status: 200, body: session(3600) }, { status: 200, body: { token_hash: HASH64 } }]);
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage: memoryStorage(), now: () => 5_000_000 });
  await auth.verifyCode('ana@exemplo.com', '123456');

  const r = await auth.createPairing();
  assert.ok(r.ok);
  assert.equal(f.calls[1].url, `${URL_BASE}/functions/v1/pair`);
  assert.equal(f.calls[1].headers.Authorization, 'Bearer acc-1');
  assert.ok(r.ok && r.qr.startsWith('nimboo://pair?') && r.qr.includes(HASH64));
});

test('QR: sem login não há o que parear; erro do servidor vira mensagem', async () => {
  const none = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: fakeFetch([]).fn, storage: memoryStorage() });
  assert.equal((await none.createPairing()).ok, false);

  const f = fakeFetch([{ status: 200, body: session(3600) }, { status: 500, body: { error: 'x' } }]);
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage: memoryStorage() });
  await auth.verifyCode('ana@exemplo.com', '123456');
  const r = await auth.createPairing();
  assert.ok(!r.ok && /QR/.test(r.message));
});

test('QR: o celular troca o token do QR por uma sessão da mesma conta', async () => {
  const f = fakeFetch([{ status: 200, body: session(3600) }]);
  const storage = memoryStorage();
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage, now: () => 1_000_000 });
  const qr = encodePairing({ url: URL_BASE, tokenHash: HASH64, now: 1_000_000 });

  assert.deepEqual(await auth.signInWithPairing(qr), { ok: true });
  assert.equal(f.calls[0].url, `${URL_BASE}/auth/v1/verify`);
  assert.deepEqual(f.calls[0].body, { type: 'magiclink', token_hash: HASH64 });
  assert.deepEqual(auth.account(), { email: 'ana@exemplo.com', userId: 'user-1' });
});

test('QR: QR vencido, de outro projeto ou recusado pelo servidor não abre sessão', async () => {
  const f = fakeFetch([{ status: 403, body: { msg: 'invalid' } }]);
  const auth = new SupabaseAuth({ url: URL_BASE, anonKey: KEY, fetch: f.fn, storage: memoryStorage(), now: () => 9_000_000 });
  const old = encodePairing({ url: URL_BASE, tokenHash: HASH64, now: 1_000_000 });
  assert.equal((await auth.signInWithPairing(old)).ok, false);
  const other = encodePairing({ url: 'https://outro.supabase.co', tokenHash: HASH64, now: 9_000_000 });
  assert.equal((await auth.signInWithPairing(other)).ok, false);
  assert.equal(f.calls.length, 0, 'QR inválido nem chega à rede');

  const fresh = encodePairing({ url: URL_BASE, tokenHash: HASH64, now: 9_000_000 });
  const denied = await auth.signInWithPairing(fresh);
  assert.ok(!denied.ok && /QR/.test(denied.message));
  assert.equal(auth.account(), null);
});
