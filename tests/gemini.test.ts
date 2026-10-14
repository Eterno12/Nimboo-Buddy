import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildGeminiBody,
  listGeminiModels,
  pickGeminiModel,
  readCandidate,
  streamGemini,
  type GeminiFetch,
} from '../electron/gemini.ts';
import { GeminiKeyStore, GEMINI_KEY_RE, type KeyCrypto } from '../electron/geminiKey.ts';
import {
  buildContext,
  buildSystemPrompt,
  CHARACTER_TONES,
  hideActionFence,
  MAX_ACTIONS,
  parseActions,
  parseLocalDue,
} from '../shared/persona.ts';
import { CHARACTERS, DEFAULT_SETTINGS, parseSettings } from '../shared/settings.ts';

const KEY = 'AIzaSyA-1234567890_abcdefghijklmnopqrstu';

const sse = (...texts: string[]) =>
  texts.map((t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`).join('');

const fetchOf = (status: number, body: string, chunk = 7): GeminiFetch => async () => {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
      c.close();
    },
  });
  return { ok: status >= 200 && status < 300, status, body: stream, text: async () => body };
};

test('gemini: junta pedaços de SSE quebrados no meio e entrega os deltas na ordem', async () => {
  const deltas: string[] = [];
  const r = await streamGemini({
    key: KEY,
    model: 'gemini-3.5-flash-lite',
    system: 's',
    turns: [{ role: 'user', text: 'oi' }],
    fetchImpl: fetchOf(200, sse('Olá, ', 'tudo ', 'bem?')),
    onDelta: (d) => deltas.push(d),
  });
  assert.deepEqual(r, { ok: true, text: 'Olá, tudo bem?' });
  assert.deepEqual(deltas, ['Olá, ', 'tudo ', 'bem?']);
});

test('gemini: a chave vai só no cabeçalho, nunca na URL, e o corpo leva identidade e histórico', async () => {
  let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
  const spy: GeminiFetch = async (url, init) => {
    seen = { url, headers: init.headers, body: init.body ?? '' };
    return fetchOf(200, sse('ok'))(url, init);
  };
  await streamGemini({
    key: KEY,
    model: 'gemini-3.8-flash',
    system: 'Você é o Nimboo.',
    turns: [
      { role: 'user', text: 'a' },
      { role: 'model', text: 'b' },
      { role: 'user', text: 'c' },
    ],
    fetchImpl: spy,
  });
  assert.ok(seen);
  const s = seen as { url: string; headers: Record<string, string>; body: string };
  assert.ok(s.url.includes('/models/gemini-3.8-flash:streamGenerateContent?alt=sse'));
  assert.ok(!s.url.includes(KEY));
  assert.equal(s.headers['x-goog-api-key'], KEY);
  const body = JSON.parse(s.body);
  assert.equal(body.systemInstruction.parts[0].text, 'Você é o Nimboo.');
  assert.deepEqual(body.contents.map((c: { role: string }) => c.role), ['user', 'model', 'user']);
  assert.ok(body.generationConfig.maxOutputTokens <= 1000);
});

test('gemini: erros viram mensagens claras (chave, cota, modelo, rede, bloqueio, timeout, cancelar)', async () => {
  const base = { key: KEY, model: 'gemini-3.5-flash-lite', system: 's', turns: [{ role: 'user' as const, text: 'oi' }] };
  const code = async (f: GeminiFetch, extra: object = {}) => {
    const r = await streamGemini({ ...base, fetchImpl: f, ...extra });
    return r.ok ? 'ok' : r.code;
  };
  assert.equal(await code(fetchOf(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}')), 'invalid_key');
  assert.equal(await code(fetchOf(403, '{}')), 'invalid_key');
  assert.equal(await code(fetchOf(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}')), 'quota');
  assert.equal(await code(fetchOf(404, '{}')), 'model');
  assert.equal(await code(fetchOf(500, '{}')), 'error');
  assert.equal(await code(async () => { throw new Error('ECONNREFUSED'); }), 'offline');
  assert.equal(await code(fetchOf(200, `data: ${JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })}\n\n`)), 'blocked');
  assert.equal(await code(fetchOf(200, '')), 'error');
  assert.equal(await streamGemini({ ...base, key: '', fetchImpl: fetchOf(200, '') }).then((r) => (r.ok ? 'ok' : r.code)), 'no_key');
  assert.equal(await streamGemini({ ...base, model: '../x', fetchImpl: fetchOf(200, '') }).then((r) => (r.ok ? 'ok' : r.code)), 'model');
  // cancelar no meio
  const ac = new AbortController();
  const hang: GeminiFetch = (_u, init) =>
    new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  const pending = streamGemini({ ...base, fetchImpl: hang, signal: ac.signal });
  ac.abort();
  assert.equal((await pending).ok, false);
  assert.equal(await code(hang, { timeoutMs: 30 }), 'timeout');
});

test('gemini: lista modelos da chave, escolhe um que existe e mostra o detalhe do erro', async () => {
  const listing = JSON.stringify({
    models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.9-flash-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ],
  });
  const r = await listGeminiModels(KEY, fetchOf(200, listing));
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.models, ['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.9-flash-preview']);
    assert.equal(pickGeminiModel(r.models, 'gemini-3.8-flash'), 'gemini-3.8-flash', 'o atual existe: mantém');
    assert.equal(pickGeminiModel(r.models, 'gemini-9-nao-existe'), 'gemini-3.5-flash-lite', 'prefere lite estável');
    assert.equal(pickGeminiModel(['gemini-2.5-flash', 'gemini-3.8-flash'], 'x'), 'gemini-3.8-flash');
    assert.equal(pickGeminiModel(['embedding-001'], 'x'), null);
  }
  const bad = await listGeminiModels(KEY, fetchOf(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}'));
  assert.ok(!bad.ok);
  if (!bad.ok && !bad.result.ok) {
    assert.equal(bad.result.code, 'invalid_key');
    assert.match(bad.result.message, /HTTP 400: API key not valid/);
  }
  const quota = await streamGemini({
    key: KEY,
    model: 'gemini-3.5-flash-lite',
    system: 's',
    turns: [{ role: 'user', text: 'oi' }],
    fetchImpl: fetchOf(429, `{"error":{"message":"Quota exceeded for ${KEY}"}}`),
  });
  assert.ok(!quota.ok);
  if (!quota.ok) {
    assert.ok(!quota.message.includes(KEY), 'a chave não pode aparecer na mensagem');
    assert.match(quota.message, /HTTP 429/);
  }
});

test('chave nova do Google (com pontos) e colada com aspas ou quebra de linha é aceita', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-key-'));
  const crypto: KeyCrypto = { isAvailable: () => true, encrypt: (s) => Buffer.from(s), decrypt: (d) => d.toString() };
  const store = new GeminiKeyStore(dir, crypto);
  const fresh = 'AQ.Ab8RN6Kj3x9_Zq-LmNoPqRsTuVwXyZ0123456789abcdEFGH';
  assert.equal(store.set(`"${fresh}"\r\n`).ok, true);
  assert.equal(store.get(), fresh);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gemini: corpo limita turnos e tamanho; readCandidate ignora formatos estranhos', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ role: (i % 2 ? 'model' : 'user') as 'user' | 'model', text: `m${i}` }));
  const body = buildGeminiBody({ system: 's', turns: [...many, { role: 'user', text: 'x'.repeat(5000) }] }) as {
    contents: { parts: { text: string }[] }[];
  };
  assert.ok(body.contents.length <= 14);
  assert.ok(body.contents.every((c) => c.parts[0].text.length <= 2000));
  assert.deepEqual(readCandidate(null), { text: '', blocked: false });
  assert.deepEqual(readCandidate({ candidates: [{ content: { parts: [{ text: 'a' }, { x: 1 }, { text: 'b' }] } }] }), { text: 'ab', blocked: false });
});

test('chave: guarda cifrada, nunca em texto simples, e recusa formatos e cifra indisponível', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-key-'));
  const crypto: KeyCrypto = {
    isAvailable: () => true,
    encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
    decrypt: (d) => Buffer.from([...d].map((b) => b ^ 0x5a)).toString(),
  };
  const store = new GeminiKeyStore(dir, crypto);
  assert.equal(store.has(), false);
  assert.equal(store.set('curta').ok, false);
  assert.equal(store.set('chave com espaço e símbolos!!!!').ok, false);
  assert.equal(store.set(`  ${KEY}  `).ok, true);
  assert.equal(store.get(), KEY);
  const onDisk = fs.readFileSync(path.join(dir, 'gemini.key'));
  assert.ok(!onDisk.toString('utf8').includes(KEY), 'não pode estar em texto simples');
  store.clear();
  assert.equal(store.has(), false);
  const noCrypto = new GeminiKeyStore(dir, { ...crypto, isAvailable: () => false });
  assert.equal(noCrypto.set(KEY).ok, false);
  assert.equal(fs.existsSync(path.join(dir, 'gemini.key')), false);
  assert.ok(GEMINI_KEY_RE.test(KEY));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('identidade: cada personagem tem tom; a instrução leva nome, regras, contexto e formato de ações', () => {
  for (const c of CHARACTERS) assert.ok(CHARACTER_TONES[c].length > 10, c);
  const p = buildSystemPrompt({
    character: 'cactus',
    name: 'Espinho',
    userNotes: 'Me chame de Gu.',
    now: new Date(2026, 9, 14, 9, 30),
    context: 'Tarefas pendentes (1):\n- Pagar boleto',
  });
  assert.match(p, /Você é Espinho/);
  assert.match(p, /Cacto/);
  assert.match(p, /determinado e bem-humorado/);
  assert.match(p, /português do Brasil/);
  assert.match(p, /Me chame de Gu/);
  assert.match(p, /Pagar boleto/);
  assert.match(p, /```acoes/);
  assert.match(p, /quarta-feira/);
  const noCtx = buildSystemPrompt({ character: 'mochi', name: 'Nimboo', userNotes: '', now: new Date(), context: null });
  assert.ok(!noCtx.includes('Contexto de hoje'));
});

test('ações propostas: valida tipos, limites e prazos; texto livre vira só texto', () => {
  const raw = [
    'Boa! Organizei assim:',
    '```acoes',
    JSON.stringify([
      { tipo: 'tarefa', titulo: 'Estudar matemática', prazo: '2026-10-15T15:00' },
      { tipo: 'tarefa', titulo: '   ' },
      { tipo: 'tarefa', titulo: 'Sem prazo', prazo: 'quinta' },
      { tipo: 'nota', texto: 'Lista de matérias' },
      { tipo: 'foco', minutos: 25 },
      { tipo: 'foco', minutos: 999 },
      { tipo: 'apagar', tudo: true },
      { tipo: 'tarefa', titulo: 't4' },
      { tipo: 'tarefa', titulo: 't5' },
      { tipo: 'tarefa', titulo: 't6' },
    ]),
    '```',
  ].join('\n');
  const r = parseActions(raw);
  assert.equal(r.text, 'Boa! Organizei assim:');
  assert.equal(r.actions.length, MAX_ACTIONS);
  assert.deepEqual(r.actions[0], {
    type: 'task',
    title: 'Estudar matemática',
    dueAt: new Date(2026, 9, 15, 15, 0).toISOString(),
    whenLabel: '15/10 às 15:00',
  });
  assert.deepEqual(r.actions[1], { type: 'task', title: 'Sem prazo', dueAt: null, whenLabel: null });
  assert.deepEqual(r.actions[2], { type: 'note', text: 'Lista de matérias' });
  assert.deepEqual(r.actions[3], { type: 'focus', minutes: 25 });
  assert.equal(parseActions('só conversa').actions.length, 0);
  assert.deepEqual(parseActions('oi\n```acoes\n{quebrado\n```'), { text: 'oi', actions: [] });
  assert.equal(parseActions('x\n```acoes\n{"tipo":"tarefa"}\n```').actions.length, 0);
  assert.equal(parseLocalDue('2026-02-31T10:00'), null);
  assert.equal(parseLocalDue('2026-13-01T10:00'), null);
  assert.equal(parseLocalDue(42), null);
});

test('streaming: o bloco de ações ainda incompleto não aparece na tela', () => {
  assert.equal(hideActionFence('Claro! ```aco'), 'Claro!');
  assert.equal(hideActionFence('sem bloco'), 'sem bloco');
});

test('contexto: só títulos e prazos, com limites', () => {
  const ctx = buildContext({
    now: new Date(),
    tasks: Array.from({ length: 12 }, (_, i) => ({ title: `Tarefa ${i}`, dueAt: i === 0 ? '2026-10-15T15:00:00.000Z' : null })),
    events: [{ time: '14:00', title: 'Reunião' }],
  });
  assert.match(ctx, /Tarefas pendentes \(12\)/);
  assert.equal(ctx.split('\n').filter((l) => l.startsWith('- Tarefa')).length, 8);
  assert.match(ctx, /14:00 Reunião/);
  assert.ok(ctx.length <= 1500);
});

test('preferências do Gemini: desligado por padrão; modelo e jeito validados', () => {
  assert.equal(DEFAULT_SETTINGS.assistantGemini, false);
  assert.equal(DEFAULT_SETTINGS.assistantContext, false);
  assert.equal(parseSettings({ version: 3, geminiModel: 'gemini-3.8-flash' }).geminiModel, 'gemini-3.8-flash');
  assert.equal(parseSettings({ version: 3, geminiModel: '../../x?key=1' }).geminiModel, DEFAULT_SETTINGS.geminiModel);
  assert.equal(parseSettings({ version: 3, assistantPersona: `  ${'a'.repeat(500)}  ` }).assistantPersona.length, 400);
  assert.equal(parseSettings({ version: 3, assistantPersona: 42 }).assistantPersona, '');
});
