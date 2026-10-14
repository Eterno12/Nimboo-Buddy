/**
 * IA online (Gemini) no app REAL, sem rede: a resposta vem de um arquivo (MOCHI_E2E_GEMINI_FIXTURE, só em app
 * não empacotado). Cobre chave cifrada, streaming, identidade, cartões de ação (aceitar/ignorar), histórico,
 * consentimento nas configurações e o aviso sem chave. Dados isolados.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = createRequire(import.meta.url)('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-gemini-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: false }));
const fixture = path.join(userData, 'gemini-fixture.json');
const ACTIONS = [
  { tipo: 'tarefa', titulo: 'Estudar matemática', prazo: '2030-01-15T15:00' },
  { tipo: 'foco', minutos: 25 },
];
fs.writeFileSync(
  fixture,
  JSON.stringify({
    chunks: [
      'Claro! Vamos organizar: ',
      'comece pela matéria mais difícil. ',
      '\n```acoes\n',
      JSON.stringify(ACTIONS),
      '\n```',
    ],
  }),
);
const KEY = 'AIzaSyA-E2E-0123456789_abcdefghijklmnop';

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  FAIL ${name}\n       ${String(error.message).split('\n').join('\n       ')}`);
  }
}

const port = 9700 + Math.floor(Math.random() * 90);
const app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  stdio: 'ignore',
  env: { ...process.env, MOCHI_E2E_GEMINI_FIXTURE: fixture },
});

async function findTarget(hash, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes(`#${hash}`));
      if (page) return page;
    } catch {
      /* subindo */
    }
    await sleep(250);
  }
  throw new Error(`alvo #${hash} não apareceu`);
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  };
  const ev = (expression) =>
    new Promise((resolve, reject) => {
      const my = ++id;
      pending.set(my, (d) => {
        if (d.result?.exceptionDetails) {
          const x = d.result.exceptionDetails;
          reject(new Error(`erro no navegador: ${x.exception?.description ?? x.text} :: ${expression.slice(0, 100)}`));
        } else resolve(d.result?.result?.value);
      });
      ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  const waitFor = async (expression, label, timeoutMs = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  return { ev, waitFor, close: () => ws.close() };
}

const conns = [];
const track = (c) => (conns.push(c), c);

try {
  console.log('Gemini — chave, conversa com streaming, ações e histórico (app real, sem rede)');
  const main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
  const gem = (expr) => main.ev(`window.mochi.assistant.gemini.${expr}`);

  await step('sem chave: status vazio; chave com formato inválido é recusada', async () => {
    const s = await gem('status()');
    assert.equal(s.hasKey, false);
    const bad = await gem(`setKey('curta')`);
    assert.equal(bad.ok, false);
    assert.equal((await gem('status()')).hasKey, false);
  });

  await step('chave válida é guardada cifrada (arquivo sem o texto da chave) e nunca volta para a interface', async () => {
    const r = await gem(`setKey(${JSON.stringify(KEY)})`);
    assert.equal(r.ok, true, JSON.stringify(r));
    const s = await gem('status()');
    assert.equal(s.hasKey, true);
    assert.deepEqual(Object.keys(s).sort(), ['encryptionAvailable', 'hasKey']);
    const bytes = fs.readFileSync(path.join(userData, 'gemini.key'));
    assert.ok(bytes.length > 20);
    assert.ok(!bytes.toString('latin1').includes(KEY), 'a chave estava em texto simples');
    const settingsText = fs.readFileSync(path.join(userData, 'settings.json'), 'utf8');
    assert.ok(!settingsText.includes(KEY));
  });

  await step('desligado por padrão: com o Gemini desligado a conversa não usa a IA online', async () => {
    const s = (await main.ev(`window.mochi.settings.get()`)).settings;
    assert.equal(s.assistantGemini, false);
    const out = await gem(`chat(1, { turns: [{ role: 'user', text: 'oi' }], context: null })`);
    assert.equal(out.ok, false);
    assert.equal(out.code, 'disabled');
  });

  await step('configurações: ativar exige marcar o aviso de envio ao Google', async () => {
    await main.ev(`window.mochi.openSettings()`);
    const panel = track(await connect(await findTarget('panel')));
    await panel.waitFor(`!!document.querySelector('[data-testid="gemini-group"]')`, 'seção do Gemini');
    // abas: a seção do Gemini só aparece na aba "Assistente"
    assert.equal(await panel.ev(`document.querySelectorAll('[role="tab"]').length`), 5);
    assert.equal(await panel.ev(`document.querySelector('[data-testid="gemini-group"]').hidden`), true);
    await panel.ev(`document.querySelector('[data-testid="settings-tab-assistant"]').click()`);
    await panel.waitFor(`document.querySelector('[data-testid="gemini-group"]').hidden === false`, 'aba Assistente');
    assert.equal(await panel.ev(`document.querySelector('[data-testid="settings-tab-assistant"]').getAttribute('aria-selected')`), 'true');
    assert.equal(await panel.ev(`document.querySelector('[data-testid="gemini-enable"]').disabled`), true);
    await panel.ev(`document.querySelector('[data-testid="gemini-consent"]').click()`);
    await panel.waitFor(`!document.querySelector('[data-testid="gemini-enable"]').disabled`, 'ativar liberado');
    const text = await panel.ev(`document.querySelector('[data-testid="gemini-group"]').innerText`);
    assert.match(text, /enviado ao Google/);
    await panel.ev(`document.querySelector('[data-testid="gemini-enable"]').click()`);
    await sleep(600);
    assert.equal((await main.ev(`window.mochi.settings.get()`)).settings.assistantGemini, true);
  });

  let chat;
  const countAssistant = `document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])').length`;
  const sendText = async (text) => {
    await chat.ev(`(() => { const t = document.querySelector('.assistant-form textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await chat.waitFor(`!document.querySelector('.assistant-send').disabled`, 'enviar');
    await chat.ev(`document.querySelector('.assistant-send').click()`);
  };

  await step('conversa: a resposta chega pelo Gemini, sem o bloco de ações no texto, com a fonte', async () => {
    await main.ev(`window.mochi.assistant.open()`);
    chat = track(await connect(await findTarget('assistant')));
    await chat.waitFor(`!!document.querySelector('.assistant-form textarea')`, 'janela');
    const before = await chat.ev(countAssistant);
    await sendText('me ajuda a organizar meus estudos de matemática');
    await chat.waitFor(`${countAssistant} > ${before} && !document.querySelector('[data-testid="chat-stop"]')`, 'resposta completa', 15000);
    const last = await chat.ev(`[...document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])')].at(-1).innerText`);
    assert.match(last, /Claro! Vamos organizar: comece pela matéria mais difícil\./);
    assert.ok(!last.includes('```') && !last.includes('"tipo"'), `bloco vazou: ${last}`);
    assert.match(last, /Fonte: Gemini \(/);
  });

  await step('cartões de ação: dois pendentes; Aceitar cria a tarefa com prazo; Ignorar descarta', async () => {
    assert.equal(await chat.ev(`document.querySelectorAll('.assistant-proposal').length`), 2);
    const labels = await chat.ev(`[...document.querySelectorAll('.assistant-proposal > span:first-child')].map((s) => s.textContent)`);
    assert.match(labels[0], /Criar tarefa: Estudar matemática \(15\/01 às 15:00\)/);
    assert.match(labels[1], /Iniciar foco de 25 min/);
    // nada acontece sozinho
    const before = await main.ev(`window.mochi.tasks.list()`);
    assert.equal(before.value.active.length, 0);
    await chat.ev(`document.querySelectorAll('[data-testid="action-accept"]')[0].click()`);
    await chat.waitFor(`document.querySelector('.assistant-proposal[data-state="done"]')?.innerText.includes('Criei a tarefa')`, 'tarefa criada');
    const list = (await main.ev(`window.mochi.tasks.list()`)).value.active;
    assert.equal(list.length, 1);
    assert.equal(list[0].title, 'Estudar matemática');
    assert.ok(list[0].dueAt && new Date(list[0].dueAt).getFullYear() === 2030);
    await chat.ev(`document.querySelector('[data-testid="action-ignore"]').click()`);
    await chat.waitFor(`document.querySelectorAll('.assistant-proposal')[1].dataset.state === 'ignored'`, 'ignorada');
    const focus = await main.ev(`window.mochi.focus.getState()`);
    assert.equal(focus.status, 'idle', 'o foco não deveria ter começado');
  });

  await step('o histórico guarda a conversa sem o bloco de ações', async () => {
    await sleep(300);
    const h = await main.ev(`window.mochi.assistant.history.list()`);
    const last = h.filter((e) => e.role === 'assistant').at(-1);
    assert.match(last.text, /comece pela matéria mais difícil\./);
    assert.ok(!last.text.includes('acoes'));
    assert.ok(h.some((e) => e.role === 'user' && e.text.includes('estudos de matemática')));
  });

  await step('remover a chave desliga o Gemini; sem chave a conversa avisa com botão para as configurações', async () => {
    await gem('clearKey()');
    assert.equal((await gem('status()')).hasKey, false);
    assert.equal(fs.existsSync(path.join(userData, 'gemini.key')), false);
    await main.ev(`window.mochi.settings.update({ assistantGemini: true })`);
    await sleep(300);
    const before = await chat.ev(countAssistant);
    await sendText('me conta uma curiosidade');
    await chat.waitFor(`${countAssistant} > ${before}`, 'aviso sem chave', 12000);
    await chat.waitFor(`/chave do Gemini/.test([...document.querySelectorAll('.assistant-msg[data-role="assistant"]')].at(-1).innerText)`, 'texto do aviso');
    const hasButton = await chat.ev(`[...document.querySelectorAll('.assistant-actions button')].some((b) => b.textContent === 'Abrir configurações')`);
    assert.equal(hasButton, true);
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  conns.forEach((c) => c.close());
  app.kill();
  await sleep(700);
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* o sistema limpa depois */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);
