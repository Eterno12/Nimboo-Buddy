/**
 * Primeira execução guiada no app REAL (MOCHI_E2E_ONBOARDING=1 liga a introdução em dados isolados):
 * abre sozinha, percorre os 5 passos, grava personagem/nome/recursos, fecha, e não volta no reinício.
 * Fechar pelo X também conta como vista.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = createRequire(import.meta.url)('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-welcome-'));
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

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let app = null;
let port = 0;
async function launch() {
  port = await freePort();
  app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
    stdio: 'ignore',
    env: { ...process.env, MOCHI_E2E_ONBOARDING: '1' },
  });
}

const targets = async () => {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page');
  } catch {
    return [];
  }
};
async function findTarget(hash, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const page = (await targets()).find((t) => t.url.includes(`#${hash}`));
    if (page) return page;
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
        if (d.result?.exceptionDetails) reject(new Error(`erro no navegador: ${d.result.exceptionDetails.exception?.description ?? d.result.exceptionDetails.text}`));
        else resolve(d.result?.result?.value);
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
try {
  console.log('Primeira execução guiada (app real, dados isolados)');
  await launch();
  const main = await connect(await findTarget('mascot'));
  conns.push(main);
  await main.waitFor(`!!window.mochi`, 'app pronto');

  let w;
  await step('instalação nova abre a introdução sozinha, com o Nimboo animado', async () => {
    w = await connect(await findTarget('welcome'));
    conns.push(w);
    await w.waitFor(`!!document.querySelector('.welcome h1')`, 'tela');
    assert.match(await w.ev(`document.querySelector('.welcome h1').textContent`), /Oi! Eu sou o Nimboo/);
    assert.equal(await w.ev(`document.querySelectorAll('.welcome-dots li').length`), 5);
    assert.ok((await w.ev(`document.querySelector('svg.mascot') !== null`)), 'mascote presente');
    assert.match(await w.ev(`getComputedStyle(document.querySelector('.welcome-mascot')).animationName`), /welcome-float/);
  });

  await step('personagem: escolher o Cacto troca na hora e grava', async () => {
    await w.ev(`document.querySelector('[data-testid="welcome-next"]').click()`);
    await w.waitFor(`!!document.querySelector('[data-testid="welcome-character-cactus"]')`, 'grade de personagens');
    assert.equal(await w.ev(`document.querySelectorAll('.welcome-characters button').length`), 8);
    await w.ev(`document.querySelector('[data-testid="welcome-character-cactus"]').click()`);
    await w.waitFor(`document.querySelector('[data-testid="welcome-character-cactus"]').getAttribute('aria-checked') === 'true'`, 'selecionado');
    assert.equal((await main.ev(`window.mochi.settings.get()`)).settings.character, 'cactus');
  });

  await step('nome: Enter aplica o nome aparado e avança para os recursos', async () => {
    await w.ev(`document.querySelector('[data-testid="welcome-next"]').click()`);
    await w.waitFor(`!!document.querySelector('[data-testid="welcome-name"]')`, 'campo de nome');
    await w.ev(
      `(() => { const el = document.querySelector('[data-testid="welcome-name"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '  Espinho  '); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await sleep(150);
    await w.ev(
      `document.querySelector('[data-testid="welcome-name"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
    );
    await w.waitFor(`document.querySelectorAll('.welcome-toggle').length === 4`, 'passo de recursos');
    assert.equal((await main.ev(`window.mochi.settings.get()`)).settings.mascotName, 'Espinho');
  });

  await step('recursos: ligar bem-estar e desligar o player gravam as preferências', async () => {
    const boxes = `document.querySelectorAll('.welcome-toggle input')`;
    await w.ev(`${boxes}[2].click(); ${boxes}[3].click();`); // player (desliga) e bem-estar (liga)
    await sleep(500);
    const s = (await main.ev(`window.mochi.settings.get()`)).settings;
    assert.equal(s.mediaPlayer, false);
    assert.equal(s.wellnessWater && s.wellnessPosture && s.wellnessEyes, true);
  });

  await step('final: confete e dicas; "Começar" fecha a janela e marca como vista', async () => {
    await w.ev(`document.querySelector('[data-testid="welcome-next"]').click()`);
    await w.waitFor(`!!document.querySelector('[data-testid="welcome-finish"]')`, 'último passo');
    assert.equal(await w.ev(`document.querySelectorAll('.welcome-confetti span').length`), 18);
    assert.match(await w.ev(`document.querySelector('.welcome-tips').innerText`), /Clique no Espinho/);
    await w.ev(`document.querySelector('[data-testid="welcome-finish"]').click()`);
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && (await targets()).some((t) => t.url.includes('#welcome'))) await sleep(200);
    assert.equal((await targets()).some((t) => t.url.includes('#welcome')), false, 'janela ainda aberta');
    assert.equal((await main.ev(`window.mochi.settings.get()`)).settings.onboardingDone, true);
  });

  await step('no reinício a introdução não volta e as escolhas ficam', async () => {
    await sleep(700);
    conns.splice(0).forEach((c) => c.close());
    app.kill();
    await sleep(1500);
    await launch();
    const m = await connect(await findTarget('mascot'));
    conns.push(m);
    await m.waitFor(`!!window.mochi`, 'app pronto');
    await sleep(3500);
    assert.equal((await targets()).some((t) => t.url.includes('#welcome')), false, 'introdução voltou');
    const s = (await m.ev(`window.mochi.settings.get()`)).settings;
    assert.equal(s.character, 'cactus');
    assert.equal(s.mascotName, 'Espinho');
  });

  await step('fechar pelo X (sem concluir) também conta como vista', async () => {
    conns.splice(0).forEach((c) => c.close());
    app.kill();
    await sleep(1500);
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, onboardingDone: false }));
    await launch();
    const m = await connect(await findTarget('mascot'));
    conns.push(m);
    const win = await connect(await findTarget('welcome'));
    await win.ev(`window.close()`);
    win.close();
    const t0 = Date.now();
    let done = false;
    while (Date.now() - t0 < 8000 && !done) {
      done = (await m.ev(`window.mochi.settings.get()`)).settings.onboardingDone === true;
      await sleep(200);
    }
    assert.equal(done, true);
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  conns.forEach((c) => c.close());
  app?.kill();
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
