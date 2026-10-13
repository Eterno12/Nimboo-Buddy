/**
 * Assistente (comandos locais, conversa, voz, perguntas) no app REAL, sem rede: as respostas da Wikipédia
 * vêm de um arquivo (`MOCHI_E2E_AI_FIXTURE`, só com o app não empacotado). Dados isolados.
 * O microfone é exercitado até onde dá sem fala: o resultado esperado aqui é a mensagem de privacidade do
 * Windows ou "não ouvi nada" (depende da configuração do computador).
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
const SHOTS = process.env.MOCHI_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-assistant-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: false }));
const fixture = path.join(userData, 'ai-fixture.json');
fs.writeFileSync(
  fixture,
  JSON.stringify({
    search: { pages: [{ key: 'Santos_Dumont', title: 'Santos Dumont' }] },
    summary: {
      title: 'Alberto Santos-Dumont',
      extract: 'Alberto Santos-Dumont foi um inventor e aeronauta brasileiro, famoso pelo voo do 14-bis em Paris.',
      content_urls: { desktop: { page: 'https://pt.wikipedia.org/wiki/Alberto_Santos-Dumont' } },
    },
  }),
);

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

const port = 9930 + Math.floor(Math.random() * 40);
const app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  stdio: 'ignore',
  env: { ...process.env, MOCHI_E2E_AI_FIXTURE: fixture },
});

async function findTarget(hashPart, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes(`#${hashPart}`));
      if (page) return page;
    } catch {
      /* subindo */
    }
    await sleep(250);
  }
  throw new Error(`alvo #${hashPart} não apareceu`);
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
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const my = ++id;
      pending.set(my, resolve);
      ws.send(JSON.stringify({ id: my, method, params }));
    });
  const ev = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(`erro no navegador: ${d.exception?.description ?? d.text} :: ${expression.slice(0, 100)}`);
    }
    return r.result?.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  const shot = async (file) => {
    if (!SHOTS) return;
    const r = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.result.data, 'base64'));
  };
  return { ev, waitFor, shot, close: () => ws.close() };
}

const conns = [];
const track = (c) => (conns.push(c), c);

try {
  console.log('Assistente — comandos, voz, perguntas (app real, sem rede, dados isolados)');
  const main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
  await main.ev(`window.mochi.assistant.open()`);
  const chat = track(await connect(await findTarget('assistant')));
  await chat.waitFor(`!!document.querySelector('.assistant-form textarea')`, 'janela do assistente');

  const say = async (text) => {
    const before = await chat.ev(`document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])').length`);
    await chat.ev(`(() => { const t = document.querySelector('.assistant-form textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await chat.waitFor(`!document.querySelector('.assistant-send').disabled`, 'botão enviar habilitado');
    await chat.ev(`document.querySelector('.assistant-send').click()`);
    await chat.waitFor(
      `document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])').length > ${before}`,
      `resposta a "${text}"`,
      12000,
    );
    return chat.ev(`[...document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])')].at(-1).innerText`);
  };
  const api = (expr) => main.ev(expr);

  await step('abre com as boas-vindas e as sugestões', async () => {
    const text = await chat.ev(`document.querySelector('.assistant-msg').innerText`);
    assert.match(text, /anoto, crio tarefas/);
    assert.equal(await chat.ev(`document.querySelectorAll('.assistant-suggest button').length`), 4);
  });

  await step('"crie uma nota escrito ..." cria a nota; "Desfazer" a remove', async () => {
    const reply = await say('Crie uma nota escrito comprar pão e leite');
    assert.match(reply, /Anotado/);
    const list = await api(`window.mochi.notes.list()`);
    assert.equal(list.value.length, 1);
    assert.equal(list.value[0].title, 'comprar pão e leite');
    await chat.ev(`[...document.querySelectorAll('.assistant-actions button')].find((b) => b.textContent === 'Desfazer').click()`);
    await chat.waitFor(`document.body.innerText.includes('(Desfeito.)')`, 'desfeito');
    assert.equal((await api(`window.mochi.notes.list()`)).value.length, 0);
  });

  await step('nota sem texto: pergunta o conteúdo e a próxima mensagem vira a nota', async () => {
    const ask = await say('crie uma nota');
    assert.match(ask, /O que devo anotar/);
    const done = await say('ideia para o aniversário da Ana');
    assert.match(done, /Anotado/);
    const list = await api(`window.mochi.notes.list()`);
    assert.equal(list.value[0].title, 'ideia para o aniversário da Ana');
  });

  await step('"me lembre de ... amanhã às 15h" cria tarefa com prazo; listar e concluir por nome', async () => {
    const reply = await say('Me lembre de ligar para o João amanhã às 15h');
    assert.match(reply, /Criei a tarefa “Ligar para o João”/);
    const lists = await api(`window.mochi.tasks.list()`);
    const task = lists.value.active.find((t) => t.title === 'Ligar para o João');
    assert.ok(task && task.dueAt);
    const due = new Date(task.dueAt);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(due.getDate(), tomorrow.getDate());
    assert.equal(due.getHours(), 15);
    const listed = await say('quais são minhas tarefas?');
    assert.match(listed, /Ligar para o João/);
    const done = await say('concluir tarefa ligar para o joao');
    assert.match(done, /Concluí “Ligar para o João”/);
    const after = await api(`window.mochi.tasks.list()`);
    assert.equal(after.value.active.some((t) => t.title === 'Ligar para o João'), false);
  });

  await step('foco: iniciar com minutos, pausar, cancelar', async () => {
    assert.match(await say('iniciar foco de 30 minutos'), /Foco de 30 minutos/);
    const s = await api(`window.mochi.focus.getState()`);
    assert.equal(s.status, 'running');
    assert.equal(Math.round(s.durationMs / 60000), 30);
    assert.match(await say('pausar o foco'), /pausado/);
    assert.match(await say('cancelar o foco'), /cancelado/);
    assert.equal((await api(`window.mochi.focus.getState()`)).status, 'idle');
  });

  await step('"mudar para o cacto" troca o personagem na hora', async () => {
    assert.match(await say('mudar para o cacto'), /Cacto/);
    assert.equal((await api(`window.mochi.settings.get()`)).settings.character, 'cactus');
    await api(`window.mochi.settings.update({ character: 'mochi' })`);
  });

  await step('pergunta sem fonte ativa: explica e oferece ativar; ativar e perguntar responde com fonte', async () => {
    const first = await say('Quem foi Santos Dumont?');
    assert.match(first, /preciso de uma fonte|fonte/);
    await chat.ev(`[...document.querySelectorAll('.assistant-actions button')].find((b) => b.textContent.includes('Wikipédia')).click()`);
    await chat.waitFor(`document.body.innerText.includes('Vou pesquisar na Wikipédia')`, 'ativado');
    assert.equal((await api(`window.mochi.settings.get()`)).settings.assistantWeb, true);
    const answer = await say('Quem foi Santos Dumont?');
    assert.match(answer, /inventor e aeronauta brasileiro/);
    assert.match(answer, /Fonte: Wikipédia: Alberto Santos-Dumont/);
    const href = await chat.ev(`[...document.querySelectorAll('.assistant-source a')].at(-1).href`);
    assert.equal(href, 'https://pt.wikipedia.org/wiki/Alberto_Santos-Dumont');
  });

  await step('microfone: termina sem travar e explica o motivo quando não há fala/permite', async () => {
    const before = await chat.ev(`document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])').length`);
    await chat.ev(`document.querySelector('.assistant-mic').click()`);
    await chat.waitFor(`document.querySelector('.assistant-mic').getAttribute('aria-pressed') === 'false' && document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])').length > ${before}`, 'escuta terminou', 30000);
    const text = await chat.ev(`[...document.querySelectorAll('.assistant-msg[data-role="assistant"]:not([aria-hidden])')].at(-1).innerText`);
    assert.match(text, /reconhecimento de fala online|Não ouvi nada|microfone|não está disponível/i);
    await chat.shot('assistant.png');
  });

  await step('sem Wikipédia/IA, de novo desligadas, a pergunta volta a pedir a fonte (privacidade por padrão)', async () => {
    await api(`window.mochi.settings.update({ assistantWeb: false })`);
    const reply = await say('qual é a capital da Austrália?');
    assert.match(reply, /fonte/);
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  for (const c of conns) {
    try {
      c.close();
    } catch {
      /* já fechado */
    }
  }
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
