/**
 * E2E da opção "só a ilha" (hideWhenAway): com ela ligada, a janela do Nimboo fica oculta quando a ilha
 * se esconde; desligar a opção traz o Nimboo para o canto. Dados isolados, app compilado.
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
const PORT = 9560 + Math.floor(Math.random() * 40);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-hideaway-'));
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  // Começa salvo como "flutuante": o app precisa abrir como ilha mesmo assim.
  JSON.stringify({ version: 3, hideWhenAway: true, hideDelaySec: 0 }),
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

const app = spawn(electronPath, [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
  stdio: ['ignore', 'ignore', 'ignore'],
});

async function findTarget(hash, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes(`#${hash}`));
      if (page) return page;
    } catch {
      /* app ainda subindo */
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
    if (r.result?.exceptionDetails) throw new Error(`erro no navegador: ${r.result.exceptionDetails.text} ${expression}`);
    return r.result?.result?.value;
  };
  const click = async (x, y) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const move = (x, y) => call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const waitFor = async (expression, label, timeoutMs = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(80);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  return { ev, click, move, waitFor, close: () => ws.close() };
}

let page;
try {
  console.log('Só a ilha — Nimboo oculto quando a ilha se esconde (app real, dados isolados)');
  page = await connect(await findTarget('mascot'));
  await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'island'`, 'ilha visível');
  await page.waitFor(`document.querySelector('.presence')?.getAnimations().length === 0`, 'entrada concluída');

  await step('opção ligada: a janela fica oculta depois que a ilha se esconde', async () => {
    assert.equal((await page.ev('window.mochi.settings.get()')).settings.hideWhenAway, true);
    assert.equal(await page.ev('document.visibilityState'), 'visible');
    await page.ev('window.mochi.islandHidden()');
    await page.waitFor(`document.visibilityState === 'hidden'`, 'janela oculta');
  });

  await step('desligar a opção traz o Nimboo para o canto', async () => {
    await page.ev('window.mochi.settings.update({ hideWhenAway: false })');
    await page.waitFor(`document.visibilityState === 'visible'`, 'janela de volta');
    await page.waitFor(`document.querySelector('.shell').dataset.mode === 'floating'`, 'Nimboo no canto');
  });

  await step('opção ligada de novo com o Nimboo no canto: ele some na hora', async () => {
    await page.ev('window.mochi.settings.update({ hideWhenAway: true })');
    await page.waitFor(`document.visibilityState === 'hidden'`, 'janela oculta');
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
  await sleep(500);
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* pasta temporária limpa depois */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`
${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);
