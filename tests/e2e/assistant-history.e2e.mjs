/**
 * Assistente+ no app REAL: adiar tarefa, fixar nota, "o que tenho amanhã?", histórico visível entre
 * aberturas da janela, apagar (botão e comando), desligar o histórico e validar o atalho. Dados isolados.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-history-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: false }));

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
const app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });

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
  console.log('Assistente+ — comandos novos e histórico (app real, dados isolados)');
  const main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');

  const openChat = async () => {
    await main.ev(`window.mochi.assistant.open()`);
    const c = track(await connect(await findTarget('assistant')));
    await c.waitFor(`!!document.querySelector('.assistant-form textarea')`, 'janela do assistente');
    return c;
  };
  const sayIn = async (chat, text) => {
    const count = `document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])').length`;
    const before = await chat.ev(count);
    await chat.ev(`(() => { const t = document.querySelector('.assistant-form textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await chat.waitFor(`!document.querySelector('.assistant-send').disabled`, 'enviar habilitado');
    await chat.ev(`document.querySelector('.assistant-send').click()`);
    await chat.waitFor(`${count} > ${before}`, `resposta a "${text}"`, 12000);
    return chat.ev(`[...document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])')].at(-1).innerText`);
  };
  const history = async () => main.ev(`window.mochi.assistant.history.list()`);

  let chat = await openChat();

  await step('"o que tenho amanhã?" responde e a conversa é guardada', async () => {
    const reply = await sayIn(chat, 'O que tenho amanhã?');
    assert.match(reply, /Amanhã está livre/);
    await sleep(300);
    const h = await history();
    assert.deepEqual(
      h.map((e) => e.role),
      ['user', 'assistant'],
    );
    assert.equal(h[0].text, 'O que tenho amanhã?');
  });

  await step('adiar: "em 2 horas" muda o prazo e "Desfazer" devolve o anterior', async () => {
    const made = await main.ev(`window.mochi.tasks.create('Enviar relatório', null)`);
    assert.ok(made.ok);
    const t0 = Date.now();
    const reply = await sayIn(chat, 'adiar enviar relatório em 2 horas');
    assert.match(reply, /Adiei “Enviar relatório”/);
    const byId = async (id) =>
      (await main.ev(`window.mochi.tasks.list()`)).value.active.find((t) => t.id === id);
    const task = await byId(made.value.id);
    const diff = new Date(task.dueAt).getTime() - t0;
    assert.ok(Math.abs(diff - 2 * 3600_000) < 120_000, `prazo em ${diff / 60000} min`);
    await chat.ev(`[...document.querySelectorAll('.assistant-actions button')].filter((b) => b.textContent === 'Desfazer').at(-1).click()`);
    await chat.waitFor(`document.body.innerText.includes('(Desfeito.)')`, 'desfeito');
    const back = await byId(made.value.id);
    assert.equal(back.dueAt, null);
  });

  await step('fixar e soltar nota pelo nome', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lista de compras' }] }] };
    const n = await main.ev(`window.mochi.notes.create({ doc: ${JSON.stringify(doc)} })`);
    assert.ok(n.ok, JSON.stringify(n));
    const pinned = await sayIn(chat, 'fixar a nota lista de compras');
    assert.match(pinned, /Fixei a nota/);
    assert.equal((await main.ev(`window.mochi.notes.get(${JSON.stringify(n.value.id)})`)).value.pinned, true);
    const loose = await sayIn(chat, 'soltar a nota lista de compras');
    assert.match(loose, /Soltei a nota/);
    assert.equal((await main.ev(`window.mochi.notes.get(${JSON.stringify(n.value.id)})`)).value.pinned, false);
  });

  await step('reabrir a janela mostra a conversa anterior com o separador', async () => {
    await sleep(400);
    await chat.ev(`window.close()`);
    await sleep(700);
    chat = await openChat();
    await chat.waitFor(`document.querySelectorAll('.assistant-msg[data-history="true"]').length >= 6`, 'histórico carregado');
    assert.equal(await chat.ev(`!!document.querySelector('.assistant-divider')`), true);
    const first = await chat.ev(`document.querySelector('.assistant-msg').innerText`);
    assert.equal(first, 'O que tenho amanhã?');
    // sugestões só na conversa nova: com histórico elas continuam visíveis (conversa de agora vazia)
    assert.equal(await chat.ev(`document.querySelectorAll('.assistant-suggest button').length`), 4);
  });

  await step('botão "Apagar histórico" pede confirmação e apaga tudo', async () => {
    await chat.ev(`document.querySelector('[data-testid="history-clear"]').click()`);
    await chat.waitFor(`!!document.querySelector('[data-testid="history-confirm"]')`, 'confirmação');
    assert.ok((await history()).length >= 6, 'ainda não apagou antes de confirmar');
    await chat.ev(`document.querySelector('[data-testid="history-confirm"]').click()`);
    await chat.waitFor(`document.body.innerText.includes('Apaguei o histórico')`, 'aviso de apagado');
    assert.deepEqual(await history(), []);
    assert.equal(await chat.ev(`document.querySelectorAll('.assistant-msg[data-history="true"]').length`), 0);
  });

  await step('comando "apagar histórico" também apaga', async () => {
    await sayIn(chat, 'ajuda');
    await sleep(300);
    assert.ok((await history()).length >= 2);
    await chat.ev(`(() => { const t = document.querySelector('.assistant-form textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'apagar histórico'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await chat.waitFor(`!document.querySelector('.assistant-send').disabled`, 'enviar');
    await chat.ev(`document.querySelector('.assistant-send').click()`);
    await chat.waitFor(`document.body.innerText.includes('Apaguei o histórico')`, 'apagado por comando');
    assert.deepEqual(await history(), []);
  });

  await step('com o histórico desligado nada é guardado', async () => {
    await main.ev(`window.mochi.settings.update({ assistantHistory: false })`);
    await sleep(400);
    await sayIn(chat, 'ajuda');
    await sleep(300);
    assert.deepEqual(await history(), []);
    await main.ev(`window.mochi.settings.update({ assistantHistory: true })`);
  });

  await step('atalho do assistente: só valores da lista; vazio desliga', async () => {
    const ok = await main.ev(`window.mochi.settings.update({ assistantShortcut: 'Control+Alt+V' })`);
    assert.equal(ok.settings.assistantShortcut, 'Control+Alt+V');
    const bad = await main.ev(`window.mochi.settings.update({ assistantShortcut: 'Control+Alt+M' })`);
    assert.equal(bad.settings.assistantShortcut, null);
    const off = await main.ev(`window.mochi.settings.update({ assistantShortcut: null })`);
    assert.equal(off.settings.assistantShortcut, null);
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
