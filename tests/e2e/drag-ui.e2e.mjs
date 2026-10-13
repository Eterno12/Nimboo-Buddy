/**
 * Teste do arraste com física no app REAL: segurar e sacudir o Mochi (no canto) o faz balançar,
 * girar e ficar enjoado por ~5 s; soltar o devolve ao repouso. Os eventos de mouse vão por CDP.
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
const PORT = 9750 + Math.floor(Math.random() * 40);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-drag-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, hideDelaySec: 3, soundEnabled: false, bubbles: false }));

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

const app = spawn(electronPath, [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });

async function findTarget(hash, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
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
    if (r.result?.exceptionDetails) throw new Error(`erro no navegador: ${r.result.exceptionDetails.text}`);
    return r.result?.result?.value;
  };
  const mouse = (type, x, y) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const waitFor = async (expression, label, timeoutMs = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(80);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  return { ev, mouse, call, waitFor, close: () => ws.close() };
}

let page;
try {
  console.log('Arraste com física (app real, dados isolados)');
  page = await connect(await findTarget('mascot'));
  await page.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'pronto');
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -40, y: -40 });
  await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'floating'`, 'Mochi no canto', 40000);
  await page.waitFor(`document.querySelector('.presence')?.getAnimations().length === 0`, 'entrada concluída');
  await sleep(300);

  const rot = () => page.ev(`parseFloat(getComputedStyle(document.querySelector('svg.mascot')).getPropertyValue('--drag-rot')) || 0`);
  const stateName = () => page.ev(`document.querySelector('svg.mascot').dataset.state`);
  const center = await page.ev(`(() => { const r = document.querySelector('.mascot-body').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const [cx, cy] = center;

  await step('segurar: estado "grabbed" e o corpo começa parado (rotação 0)', async () => {
    await page.mouse('mouseMoved', cx, cy);
    await page.mouse('mousePressed', cx, cy);
    await page.mouse('mouseMoved', cx + 6, cy); // passa do limiar de arraste
    await page.waitFor(`document.querySelector('svg.mascot').dataset.state === 'grabbed'`, 'grabbed');
    assert.ok(Math.abs(await rot()) < 5);
  });

  let peak = 0;
  const seen = new Set();

  await step('movimento brusco para um lado inclina o corpo (balança) e ele nunca fica torto sem motivo', async () => {
    for (let i = 0; i < 12; i++) {
      await page.mouse('mouseMoved', cx + 6 + i * 14, cy);
      await sleep(16);
    }
    for (let i = 0; i < 12; i++) {
      peak = Math.max(peak, Math.abs(await rot()));
      await sleep(16);
    }
    assert.ok(peak > 4, `inclinou: ${peak.toFixed(1)}°`);
  });

  await step('sacudir com força: gira e fica enjoado (state "dizzy")', async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 9000 && !seen.has('dizzy')) {
      // Tempo REAL: a frequência da sacudida não pode depender de quantas chamadas CDP cabem por quadro.
      const t = (Date.now() - t0) / 1000;
      const x = cx + 6 + 150 * Math.sin(2 * Math.PI * 2.2 * t);
      await page.mouse('mouseMoved', x, cy + 20 * Math.sin(t * 5));
      peak = Math.max(peak, Math.abs(await rot()));
      seen.add(await stateName());
      await sleep(12);
    }
    assert.ok(peak > 90, `girou (pico ${peak.toFixed(0)}°)`);
    assert.ok(seen.has('dizzy'), `estados vistos: ${[...seen].join(', ')}`);
  });

  await step('soltar: o giro acaba, o corpo volta a 0° e o enjoo termina em ~5 s', async () => {
    await page.mouse('mouseReleased', cx, cy);
    await page.waitFor(`Math.abs(parseFloat(getComputedStyle(document.querySelector('svg.mascot')).getPropertyValue('--drag-rot')) || 0) < 1`, 'rotação zerada', 9000);
    assert.equal(await stateName(), 'dizzy', 'segue enjoado logo depois de soltar');
    const t0 = Date.now();
    await page.waitFor(`document.querySelector('svg.mascot').dataset.state !== 'dizzy'`, 'enjoo termina', 8000);
    const took = Date.now() - t0;
    assert.ok(took < 7000, `o enjoo durou mais do que o esperado: ${took} ms após zerar a rotação`);
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
    /* ainda em uso */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);