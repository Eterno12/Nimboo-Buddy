/**
 * Tarefas completas no app REAL (painel): editar título, prioridade, subtarefas (várias), prazo + repetição +
 * adiar, concluir tarefa que repete, reordenar (arrastar e Alt+setas) e excluir/desfazer com subtarefas.
 * Dados isolados; sem mouse do sistema. `MOCHI_SHOTS=<pasta>` grava uma captura.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-taskscomplete-'));
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

const port = 9880 + Math.floor(Math.random() * 40);
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
      throw new Error(`erro no navegador: ${d.exception?.description ?? d.text} :: ${expression.slice(0, 110)}`);
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

const setValue = (selector, value) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`;
const row = (title) =>
  `[...document.querySelectorAll('.tasks-list > .task')].find((li) => li.querySelector('.task-title, .task-rename')?.textContent.includes(${JSON.stringify(title)}) || li.querySelector('.task-rename')?.value === ${JSON.stringify(title)})`;

let main;
let panel;
try {
  console.log('Tarefas completas — editar, prioridade, subtarefas, repetição, adiar, ordem (app real, dados isolados)');
  main = await connect(await findTarget('mascot'));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
  const api = (expr) => main.ev(expr);

  const mk = async (title, due = null, extra = {}) => {
    const r = await api(`window.mochi.tasks.create(${JSON.stringify(title)}, ${JSON.stringify(due)}, null, ${JSON.stringify(extra)})`);
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.value;
  };
  const soon = new Date(Date.now() + 2 * 3600_000);
  soon.setSeconds(0, 0);
  const A = await mk('Alfa');
  const B = await mk('Bravo', soon.toISOString());
  const C = await mk('Charlie');

  await api(`window.mochi.openSettings()`);
  panel = await connect(await findTarget('panel'));
  await panel.waitFor(`!!document.querySelector('.settings')`, 'configurações');
  await panel.ev(`document.querySelector('.settings-back').click()`);
  await panel.waitFor(`document.querySelectorAll('.tasks-list > .task').length === 3`, 'três tarefas');

  await step('editar título: duplo clique, digitar e Enter grava; Escape cancela', async () => {
    await panel.ev(`${row('Alfa')}.querySelector('.task-title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await panel.waitFor(`!!document.querySelector('.task-rename')`, 'campo de edição');
    await panel.ev(setValue('.task-rename', 'Alfa renomeada'));
    await panel.ev(`document.querySelector('.task-rename').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await panel.waitFor(`!!${row('Alfa renomeada')} && !document.querySelector('.task-rename')`, 'renomeada');
    assert.equal((await api(`window.mochi.tasks.get ? 1 : 0`)), 0);
    const list = await api(`window.mochi.tasks.list()`);
    assert.ok(list.value.active.some((t) => t.title === 'Alfa renomeada'));
    // Escape não grava
    await panel.ev(`${row('Alfa renomeada')}.querySelector('.task-title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await panel.waitFor(`!!document.querySelector('.task-rename')`, 'campo de edição 2');
    await panel.ev(setValue('.task-rename', 'NAO DEVE GRAVAR'));
    await panel.ev(`document.querySelector('.task-rename').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await panel.waitFor(`!document.querySelector('.task-rename')`, 'cancelou');
    const after = await api(`window.mochi.tasks.list()`);
    assert.ok(after.value.active.every((t) => t.title !== 'NAO DEVE GRAVAR'));
  });

  await step('prioridade: cada clique avança (nenhuma → baixa → média → alta → nenhuma)', async () => {
    const seen = [];
    for (let i = 0; i < 4; i++) {
      await panel.ev(`${row('Alfa renomeada')}.querySelector('.task-priority').click()`);
      await sleep(250);
      const list = await api(`window.mochi.tasks.list()`);
      seen.push(list.value.active.find((t) => t.title === 'Alfa renomeada').priority);
    }
    assert.deepEqual(seen, [1, 2, 3, 0]);
    await panel.ev(`${row('Alfa renomeada')}.querySelector('.task-priority').click()`); // deixa em "baixa"
    await sleep(250);
  });

  await step('subtarefas: várias na mesma tarefa, contador e conclusão individual', async () => {
    await panel.ev(`${row('Charlie')}.querySelector('.task-addsub').click()`);
    for (const sub of ['Passagens', 'Hotel', 'Malas']) {
      await panel.waitFor(`!!document.querySelector('.task-sub-input')`, 'campo da subtarefa');
      await panel.ev(setValue('.task-sub-input', sub));
      await panel.ev(`document.querySelector('.task-subform').requestSubmit()`);
      await panel.waitFor(`[...document.querySelectorAll('.task-sub-title')].some((e) => e.textContent === ${JSON.stringify(sub)})`, `subtarefa ${sub}`);
    }
    assert.equal(await panel.ev(`document.querySelectorAll('.task-sub').length`), 3);
    assert.equal(await panel.ev(`${row('Charlie')}.querySelector('.task-subcount').textContent.trim()`), '0/3');
    await panel.ev(`${row('Charlie')}.querySelector('.task-sub-check').click()`);
    await panel.waitFor(`${row('Charlie')}.querySelector('.task-subcount').textContent.trim() === '1/3'`, 'contador 1/3');
    // a subtarefa concluída continua sob a principal (não vai para "Concluídas")
    assert.equal(await panel.ev(`document.querySelector('.tasks-disclosure').textContent.includes('(0)')`), true);
    await panel.shot('tasks-complete.png');
  });

  await step('prazo: adiar +10 min, repetir "Todo dia" e, ao concluir, nasce a próxima ocorrência', async () => {
    await panel.ev(`${row('Bravo')}.querySelector('.task-due').click()`);
    await panel.waitFor(`!!document.querySelector('.task-due-editor')`, 'editor de prazo');
    const before = (await api(`window.mochi.tasks.list()`)).value.active.find((t) => t.title === 'Bravo').dueAt;
    await panel.ev(`[...document.querySelectorAll('.task-snooze button')].find((b) => b.textContent === '+10 min').click()`);
    await sleep(400);
    const snoozed = (await api(`window.mochi.tasks.list()`)).value.active.find((t) => t.title === 'Bravo').dueAt;
    const diff = Date.parse(snoozed) - Date.now();
    assert.ok(diff > 8 * 60_000 && diff < 11 * 60_000, `adiou para daqui a ${Math.round(diff / 60000)} min`);
    assert.notEqual(snoozed, before);
    // repetição
    await panel.waitFor(`!!document.querySelector('.task-due-editor select')`, 'seletor de repetição');
    await panel.ev(setValue('.task-due-editor select', 'daily'));
    await sleep(400);
    const rec = (await api(`window.mochi.tasks.list()`)).value.active.find((t) => t.title === 'Bravo');
    assert.equal(rec.recurrence, 'daily');
    // concluir
    await panel.ev(`${row('Bravo')}.querySelector('.task-primary').click()`);
    await sleep(500);
    const lists = (await api(`window.mochi.tasks.list()`)).value;
    const next = lists.active.find((t) => t.title === 'Bravo');
    assert.ok(next, 'próxima ocorrência criada');
    assert.equal(next.recurrence, 'daily');
    const nextDay = new Date(snoozed);
    nextDay.setDate(nextDay.getDate() + 1);
    assert.ok(Math.abs(Date.parse(next.dueAt) - nextDay.getTime()) < 60_000, `${next.dueAt} vs ${nextDay.toISOString()}`);
    assert.equal(lists.completed.filter((t) => t.title === 'Bravo').length, 1);
  });

  await step('ordem: Alt+↓ move a tarefa e arrastar-e-soltar também reordena', async () => {
    const order = async () => (await api(`window.mochi.tasks.list()`)).value.active.filter((t) => !t.parentId).map((t) => t.title);
    const start = await order();
    const first = start[0];
    await panel.ev(`${row(first)}.querySelector('.task-primary').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }))`);
    await sleep(500);
    const moved = await order();
    assert.equal(moved[1], first, `${start} -> ${moved}`);
    // arrastar: o último vai para o topo
    const last = moved.at(-1);
    await panel.ev(`(() => {
      const li = ${row(last)}; const top = document.querySelector('.tasks-list > .task');
      const dt = new DataTransfer();
      li.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      top.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      top.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      li.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    })()`);
    await sleep(600);
    const final = await order();
    assert.equal(final[0], last, `${moved} -> ${final}`);
    await panel.waitFor(`document.querySelector('.tasks-list > .task .task-title').textContent.includes(${JSON.stringify(last)})`, 'tela refletiu a ordem');
  });

  await step('excluir a principal esconde as subtarefas; desfazer devolve tudo; ao final apaga as subtarefas', async () => {
    const countBefore = (await api(`window.mochi.tasks.list()`)).value.active.length;
    await panel.ev(`${row('Charlie')}.querySelector('.task-remove').click()`);
    await panel.waitFor(`!!document.querySelector('.tasks-undo') && ![...document.querySelectorAll('.task-sub-title')].length`, 'excluída e sem subtarefas na tela');
    await panel.ev(`document.querySelector('.tasks-undo-button').click()`);
    await panel.waitFor(`document.querySelectorAll('.task-sub').length === 3`, 'subtarefas de volta');
    assert.equal((await api(`window.mochi.tasks.list()`)).value.active.length, countBefore);
    // exclusão definitiva
    await panel.ev(`${row('Charlie')}.querySelector('.task-remove').click()`);
    await sleep(5800);
    const lists = (await api(`window.mochi.tasks.list()`)).value;
    assert.ok(![...lists.active, ...lists.completed].some((t) => ['Charlie', 'Passagens', 'Hotel', 'Malas'].includes(t.title)));
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  for (const c of [main, panel]) {
    try {
      c?.close();
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
