/**
 * Ligações entre tarefas, notas e eventos no app REAL: anotações da tarefa (uma nota por tarefa),
 * nota -> tarefa (seleção/linha e "Criar tarefa da nota"). Dados isolados; sem mouse do sistema.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-links-'));
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

const port = 9780 + Math.floor(Math.random() * 40);
const app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });

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
  const waitFor = async (expression, label, timeoutMs = 8000) => {
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
  console.log('Ligações — anotações da tarefa e nota → tarefa (app real, dados isolados)');
  const main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
  const api = (e) => main.ev(e);

  const created = await api(`window.mochi.tasks.create('Preparar a apresentação', null)`);
  assert.equal(created.ok, true);
  const taskId = created.value.id;

  await api(`window.mochi.openSettings()`);
  const panel = track(await connect(await findTarget('panel')));
  await panel.waitFor(`!!document.querySelector('.settings')`, 'configurações');
  await panel.ev(`document.querySelector('.settings-back').click()`);
  await panel.waitFor(`!!document.querySelector('[data-task-id="${taskId}"] .task-note')`, 'botão de anotações');

  let manager;
  await step('"Anotações" da tarefa cria UMA nota ligada e abre a janela de notas', async () => {
    assert.equal(await panel.ev(`document.querySelector('[data-task-id="${taskId}"] .task-note').dataset.has`), 'false');
    await panel.ev(`document.querySelector('[data-task-id="${taskId}"] .task-note').click()`);
    manager = track(await connect(await findTarget('notes=')));
    await manager.waitFor(`!!document.querySelector('.note-prose')`, 'editor aberto');
    const list = await api(`window.mochi.notes.list()`);
    const linked = list.value.filter((n) => n.taskId === taskId);
    assert.equal(linked.length, 1);
    assert.equal(linked[0].title, 'Preparar a apresentação');
    assert.equal(await manager.ev(`document.querySelector('.notes-link-badge')?.textContent`), 'Anotações de uma tarefa');
    // o botão passa a indicar que já existe
    await panel.waitFor(`document.querySelector('[data-task-id="${taskId}"] .task-note').dataset.has === 'true'`, 'marcado');
  });

  await step('clicar de novo abre a MESMA nota (não duplica)', async () => {
    await panel.ev(`document.querySelector('[data-task-id="${taskId}"] .task-note').click()`);
    await sleep(600);
    const list = await api(`window.mochi.notes.list()`);
    assert.equal(list.value.filter((n) => n.taskId === taskId).length, 1);
    assert.equal(list.value.length, 1);
  });

  await step('nota → tarefa: a linha com o cursor vira tarefa pelo botão da barra', async () => {
    await manager.ev(`(() => { const el = document.querySelector('.note-prose'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('insertParagraph'); document.execCommand('insertText', false, 'Reservar a sala de reunião'); })()`);
    await manager.ev(`document.querySelector('[aria-label^="Transformar a seleção"]').click()`);
    await manager.waitFor(`!!document.querySelector('.notes-toast')`, 'aviso');
    const lists = await api(`window.mochi.tasks.list()`);
    assert.ok(lists.value.active.some((t) => t.title === 'Reservar a sala de reunião'));
  });

  await step('nota → tarefa: seleção parcial vira o título da tarefa', async () => {
    await manager.ev(`(() => { document.querySelector('.note-prose').focus(); const ps = [...document.querySelectorAll('.note-prose p')]; const p = ps.find((x) => x.textContent.includes('Reservar')); const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); const t = w.nextNode(); const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 7); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    await sleep(400); // o editor lê a seleção do DOM de forma assíncrona
    await manager.ev(`document.querySelector('[aria-label^="Transformar a seleção"]').click()`);
    await sleep(500);
    const lists = await api(`window.mochi.tasks.list()`);
    assert.ok(lists.value.active.some((t) => t.title === 'Reserva'), JSON.stringify(lists.value.active.map((x) => x.title)));
  });

  await step('"Criar tarefa da nota" usa o título da nota', async () => {
    await manager.ev(`[...document.querySelectorAll('.notes-action')].find((b) => b.textContent.includes('Criar tarefa da nota')).click()`);
    await sleep(500);
    const lists = await api(`window.mochi.tasks.list()`);
    assert.ok(lists.value.active.filter((t) => t.title === 'Preparar a apresentação').length >= 2, 'a original e a nova');
  });

  await step('a lista de notas marca a nota ligada', async () => {
    const tag = await manager.ev(`document.querySelector('.notes-item .notes-item-tag')?.textContent ?? ''`);
    assert.match(tag, /tarefa/);
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
