import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OLLAMA_BASE,
  WIKI_HOST,
  askOllama,
  askWikipedia,
  cleanQuestion,
  clipAnswer,
  ollamaStatus,
  pullOllamaModel,
  type FetchLike,
} from '../electron/assistantAi.ts';
import { MODEL_NAME_RE, parseSettings } from '../shared/settings.ts';
import { createSpeechListener, listenScript, mapHresult, parseSpeechOutput } from '../electron/speech.ts';

const json = (body: unknown, ok = true, status = 200) => (): ReturnType<FetchLike> =>
  Promise.resolve({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

/** Fetch falso: roteia por prefixo de URL e registra o que foi chamado. */
function fakeFetch(routes: Record<string, () => ReturnType<FetchLike>>) {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return handler();
    }
    throw new Error(`rota inesperada: ${url}`);
  };
  return { f, calls };
}

test('pergunta: a "casca" é removida para a busca', () => {
  assert.equal(cleanQuestion('Quem foi Santos Dumont?'), 'Santos Dumont');
  assert.equal(cleanQuestion('o que é fotossíntese'), 'fotossíntese');
  assert.equal(cleanQuestion('qual é a capital da Austrália?'), 'capital da Austrália');
  assert.equal(cleanQuestion('me fale sobre o Sol'), 'Sol');
  assert.equal(cleanQuestion('pesquise sobre buracos negros'), 'buracos negros');
  assert.equal(cleanQuestion('Machado de Assis'), 'Machado de Assis');
  assert.ok(cleanQuestion('x'.repeat(500)).length <= 120);
});

test('resposta longa é cortada em frase inteira', () => {
  const text = 'Primeira frase. '.repeat(100);
  const clipped = clipAnswer(text, 200);
  assert.ok(clipped.length <= 200 && clipped.endsWith('.'));
  assert.equal(clipAnswer('curta'), 'curta');
});

test('Wikipédia: busca e resumo; só https e só o host permitido; link validado', async () => {
  const { f, calls } = fakeFetch({
    [`https://${WIKI_HOST}/w/rest.php/v1/search/page`]: json({ pages: [{ key: 'Santos_Dumont', title: 'Santos Dumont' }] }),
    [`https://${WIKI_HOST}/api/rest_v1/page/summary/Santos_Dumont`]: json({
      title: 'Alberto Santos-Dumont',
      extract: 'Alberto Santos-Dumont foi um inventor e aeronauta brasileiro. Ficou famoso pelo 14-bis.',
      content_urls: { desktop: { page: 'https://pt.wikipedia.org/wiki/Santos_Dumont' } },
    }),
  });
  const r = await askWikipedia('Quem foi Santos Dumont?', f);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.source, 'wikipedia');
  assert.equal(r.title, 'Alberto Santos-Dumont');
  assert.match(r.text, /aeronauta brasileiro/);
  assert.equal(r.url, 'https://pt.wikipedia.org/wiki/Santos_Dumont');
  assert.match(calls[0].url, /q=Santos%20Dumont/);
  assert.ok(calls.every((c) => c.url.startsWith('https://pt.wikipedia.org/')));
});

test('Wikipédia: link de outro domínio é descartado; sem resultado e sem internet têm mensagens próprias', async () => {
  const evil = fakeFetch({
    [`https://${WIKI_HOST}/w/rest.php`]: json({ pages: [{ key: 'X' }] }),
    [`https://${WIKI_HOST}/api/rest_v1`]: json({ title: 'X', extract: 'Texto.', content_urls: { desktop: { page: 'https://evil.example/x' } } }),
  });
  const a = await askWikipedia('x tema', evil.f);
  assert.ok(a.ok && a.url === undefined);

  const none = fakeFetch({ [`https://${WIKI_HOST}/w/rest.php`]: json({ pages: [] }) });
  const b = await askWikipedia('assunto inexistente zzz', none.f);
  assert.deepEqual(b.ok, false);
  if (!b.ok) assert.equal(b.code, 'not_found');

  const offline: FetchLike = async () => {
    throw new Error('ENOTFOUND');
  };
  const c = await askWikipedia('qualquer coisa', offline);
  assert.ok(!c.ok && c.code === 'offline');
});

test('Ollama: só 127.0.0.1; modelo ausente e serviço parado são distinguidos; resposta é entregue', async () => {
  const running = fakeFetch({
    [`${OLLAMA_BASE}/api/tags`]: json({ models: [{ name: 'qwen2.5:3b' }, { name: 'llama3.2:latest' }] }),
    [`${OLLAMA_BASE}/api/chat`]: json({ message: { role: 'assistant', content: 'Brasília é a capital do Brasil.' } }),
  });
  const ok = await askOllama('Qual a capital do Brasil?', [{ role: 'user', content: 'oi' }], 'qwen2.5:3b', running.f);
  assert.ok(ok.ok && ok.source === 'ollama' && ok.text.includes('Brasília'));
  const chat = running.calls.find((c) => c.url.endsWith('/api/chat'))!;
  const body = JSON.parse(chat.init!.body!);
  assert.equal(body.stream, false);
  assert.equal(body.model, 'qwen2.5:3b');
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages.at(-1).content, 'Qual a capital do Brasil?');
  assert.ok(running.calls.every((c) => c.url.startsWith('http://127.0.0.1:11434/')));

  const missing = await askOllama('oi', [], 'gemma2:2b', running.f);
  assert.ok(!missing.ok && missing.code === 'model_missing');

  const down: FetchLike = async () => {
    throw new Error('ECONNREFUSED');
  };
  const stopped = await askOllama('oi', [], 'qwen2.5:3b', down);
  assert.ok(!stopped.ok && stopped.code === 'ollama_missing');
  assert.deepEqual(await ollamaStatus(down), { running: false, models: [] });
  assert.deepEqual((await ollamaStatus(running.f)).models, ['qwen2.5:3b', 'llama3.2:latest']);
});

test('Ollama: baixar modelo acompanha o progresso e reporta erro do servidor', async () => {
  const lines = [
    JSON.stringify({ status: 'pulling manifest' }),
    JSON.stringify({ status: 'downloading', total: 1000, completed: 250 }),
    JSON.stringify({ status: 'downloading', total: 1000, completed: 1000 }),
    JSON.stringify({ status: 'success' }),
  ].join('\n') + '\n';
  const bytes = new TextEncoder().encode(lines);
  const stream = (data: Uint8Array) => {
    let sent = false;
    return {
      getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: data })),
      }),
    };
  };
  const make = (payload: Uint8Array): FetchLike => async (url) =>
    url.endsWith('/api/tags')
      ? { ok: true, status: 200, json: async () => ({ models: [] }), text: async () => '' }
      : { ok: true, status: 200, json: async () => ({}), text: async () => '', body: stream(payload) };
  const seen: (number | null)[] = [];
  const ok = await pullOllamaModel('qwen2.5:3b', make(bytes), (p) => seen.push(p.fraction));
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(seen.filter((x) => x !== null), [0.25, 1]);

  const bad = await pullOllamaModel('nao-existe', make(new TextEncoder().encode(JSON.stringify({ error: 'pull model manifest: file does not exist' }) + '\n')), () => {});
  assert.equal(bad.ok, false);
});

test('preferências do assistente: padrão desligado; modelo validado', () => {
  const d = parseSettings({ version: 3 });
  assert.equal(d.assistantWeb, false);
  assert.equal(d.assistantLocalAi, false);
  assert.equal(d.assistantModel, 'qwen2.5:3b');
  const s = parseSettings({ version: 3, assistantWeb: true, assistantLocalAi: true, assistantModel: 'llama3.2:3b' });
  assert.deepEqual([s.assistantWeb, s.assistantLocalAi, s.assistantModel], [true, true, 'llama3.2:3b']);
  for (const bad of ['', 'a b', '../../x', 'http://evil', 'x'.repeat(200), 'ok;rm', 'qwen2.5:3b\n', 7]) {
    assert.equal(parseSettings({ version: 3, assistantModel: bad }).assistantModel, 'qwen2.5:3b', JSON.stringify(bad));
  }
  assert.ok(MODEL_NAME_RE.test('library/qwen2.5:3b-instruct'));
  assert.equal(parseSettings({ version: 3, assistantWeb: 'sim' }).assistantWeb, false);
});

test('voz: a saída do reconhecedor vira texto ou um erro com mensagem em português', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  assert.deepEqual(parseSpeechOutput(`RESULT ${b64('crie uma nota escrito comprar pão')}\r\n`), { ok: true, text: 'crie uma nota escrito comprar pão' });
  const privacy = parseSpeechOutput('ERROR 80045509');
  assert.ok(privacy && !privacy.ok && privacy.error.code === 'privacy' && /Privacidade/.test(privacy.error.message));
  assert.equal(mapHresult('0x80070005'), 'microphone');
  assert.equal(mapHresult('C00D3704'), 'microphone');
  assert.equal(mapHresult('12345678'), 'unavailable');
  const silent = parseSpeechOutput('STATUS TimeoutExceeded');
  assert.ok(silent && !silent.ok && silent.error.code === 'no_speech');
  assert.equal(parseSpeechOutput('lixo qualquer'), null);
  assert.ok(parseSpeechOutput('RESULT ') !== null, 'resultado vazio vira "não ouvi nada"');
});

test('voz: o script é uma única linha, escapa o idioma e não usa nada fora do reconhecedor', () => {
  const script = listenScript('pt-BR');
  assert.ok(!script.includes('\n'));
  assert.match(script, /SpeechRecognizer/);
  assert.match(listenScript("pt-BR'; calc; '"), /Language\('pt-BR'\)/, 'idioma inválido volta ao padrão');
  assert.ok(!/Invoke-Expression|iex |DownloadString|Start-Process/i.test(script));
});

test('voz: só uma escuta por vez; cancelar encerra com "canceled"', async () => {
  const { EventEmitter } = await import('node:events');
  const children: (InstanceType<typeof EventEmitter> & { kill(): void; stdout: InstanceType<typeof EventEmitter> })[] = [];
  const spawn = (() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill() {} });
    children.push(child);
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  const listener = createSpeechListener({ spawn, maxMs: 5000 });
  const first = listener.listen();
  const second = await listener.listen();
  assert.ok(!second.ok && second.error.code === 'busy');
  children[0].stdout.emit('data', Buffer.from(`RESULT ${Buffer.from('olá').toString('base64')}\n`));
  assert.deepEqual(await first, { ok: true, text: 'olá' });

  const third = listener.listen();
  listener.cancel();
  const r = await third;
  assert.ok(!r.ok && r.error.code === 'canceled');
});
