/**
 * Teste do app EMPACOTADO (release/win-unpacked/Nimboo.exe, gerado por `npm run pack`).
 * Confere o que só muda fora do desenvolvimento: `app.isPackaged`, caminho dos dados, banco,
 * preferências e a janela da ilha. Usa dados isolados (`--user-data-dir`).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = path.join(root, 'release', 'win-unpacked', 'Nimboo.exe');
if (!fs.existsSync(exe)) {
  console.log('Nimboo.exe não encontrado: rode `npm run pack` antes.');
  process.exit(2);
}
const PORT = 9620 + Math.floor(Math.random() * 40);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-packaged-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, mode: 'floating' }));

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

const app = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });

async function findTarget(hash, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes(`#${hash}`));
      if (page) return page;
    } catch {
      /* ainda subindo */
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
        if (d.result?.exceptionDetails) reject(new Error(`erro no navegador: ${d.result.exceptionDetails.text}`));
        else resolve(d.result?.result?.value);
      });
      ws.send(
        JSON.stringify({
          id: my,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
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

let page;
try {
  console.log('App empacotado (Nimboo.exe, dados isolados)');
  page = await connect(await findTarget('mascot'));
  await page.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');

  await step('abre como ilha mesmo com o modo flutuante salvo', async () => {
    await page.waitFor(`document.querySelector('.shell').dataset.mode === 'island'`, 'ilha');
    assert.equal(await page.ev('window.outerWidth'), 352);
  });

  await step('reconhece que está instalado (packaged) e "iniciar com o Windows" fica disponível', async () => {
    const s = await page.ev(`window.mochi.settings.get()`);
    assert.equal(s.packaged, true);
  });

  await step('tarefas: cria com prazo, lista e grava no banco dos dados isolados', async () => {
    const due = new Date(Date.now() + 3600_000).toISOString();
    const r = await page.ev(`window.mochi.tasks.create('Tarefa do app empacotado', ${JSON.stringify(due)})`);
    assert.equal(r.ok, true);
    const list = await page.ev(`window.mochi.tasks.list()`);
    assert.equal(list.value.active.length, 1);
    assert.ok(fs.existsSync(path.join(userData, 'data', 'mochi.db')), 'o banco foi criado em userData');
  });

  await step('modo foco: inicia, pausa e cancela', async () => {
    const s = await page.ev(`window.mochi.focus.start('focus', 2)`);
    assert.equal(s.ok, true);
    assert.equal((await page.ev(`window.mochi.focus.pause()`)).ok, true);
    assert.equal((await page.ev(`window.mochi.focus.cancel()`)).ok, true);
  });

  await step('preferências: atualização é gravada em disco (settings.json) ao sair', async () => {
    const s = await page.ev(`window.mochi.settings.update({ islandScale: 1.1, color: 'sky' })`);
    assert.equal(s.settings.islandScale, 1.1);
    assert.equal(s.effective.islandScale, 1.1);
    await page.waitFor(`window.outerWidth === 387`, 'janela ampliada');
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  try {
    page?.close();
  } catch {
    /* já fechado */
  }
  app.kill();
  await sleep(800);
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* arquivos ainda em uso */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);
