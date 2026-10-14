/**
 * Aviso de lembrete com botões (Concluir / Adiar / Dispensar) no app REAL, com dados isolados.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-reminder-'));
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: false, routineMorning: false, routineEvening: false, remindersEnabled: true, reminderLeadMin: 0, onboardingDone: true }),
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

let port = 9800;
let app = null;
const launch = () => {
  port = 9800 + Math.floor(Math.random() * 80);
  app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });
};

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

async function hasTarget(hash) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    return list.some((t) => t.type === 'page' && t.url.includes(`#${hash}`));
  } catch {
    return false;
  }
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
const closeAll = () => conns.splice(0).forEach((c) => c.close());

const inSeconds = (n) => new Date(Date.now() + n * 1000).toISOString();

try {
  console.log('Aviso de lembrete — Concluir e Adiar pelo aviso (app real, dados isolados)');
  launch();
  const main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');

  await step('na hora do prazo aparece o aviso com o título e os três botões', async () => {
    await main.ev(`window.mochi.tasks.create('Beber água', ${JSON.stringify(inSeconds(3))})`);
    const toast = track(await connect(await findTarget('reminder=', 20000)));
    await toast.waitFor(`!!document.body && document.body.innerText.includes('Beber água')`, 'título');
    const labels = await toast.ev(`[...document.querySelectorAll('.rem-btn')].map((b) => b.textContent)`);
    assert.deepEqual(labels, ['Concluir', 'Adiar 10 min', 'Dispensar']);
    await toast.ev(`document.querySelectorAll('.rem-btn')[1].click()`);
    const t0 = Date.now();
    while (await hasTarget('reminder=')) {
      assert.ok(Date.now() - t0 < 5000, 'o aviso deveria fechar ao adiar');
      await sleep(100);
    }
  });

  await step('Concluir pelo aviso conclui a tarefa', async () => {
    await main.ev(`window.mochi.tasks.create('Enviar relatório', ${JSON.stringify(inSeconds(3))})`);
    const toast = track(await connect(await findTarget('reminder=', 20000)));
    await toast.waitFor(`!!document.body && document.body.innerText.includes('Enviar relatório')`, 'título');
    await toast.ev(`document.querySelector('.rem-btn[data-primary=true]').click()`);
    await main.waitFor(
      `window.mochi.tasks.list().then((r) => r.ok && r.value.completed.some((t) => t.title === 'Enviar relatório'))`,
      'tarefa concluída',
    );
  });
} finally {
  closeAll();
  app?.kill();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
  if (failed.length > 0) process.exitCode = 1;
}
