/**
 * Bem-estar no app REAL: tudo desligado por padrão, controles nas configurações (ligar, intervalo),
 * valores inválidos corrigidos e persistência entre reinícios. O disparo no tempo é coberto pelos testes
 * unitários (relógio injetável); aqui não se espera 20 minutos. Dados isolados.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-wellness-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false }));

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

let port = 9900;
let app = null;
const launch = () => {
  port = 9900 + Math.floor(Math.random() * 80);
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
const FIELDSET = `[...document.querySelectorAll('.settings-group')].find((f) => f.querySelector('legend')?.textContent === 'Bem-estar')`;

try {
  console.log('Bem-estar — padrões, controles, validação e persistência (app real, dados isolados)');
  launch();
  let main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');

  await step('tudo vem desligado por padrão, com intervalos de água 60, postura 45 e olhos 20', async () => {
    const s = (await main.ev(`window.mochi.settings.get()`)).settings;
    assert.equal(s.wellnessWater, false);
    assert.equal(s.wellnessPosture, false);
    assert.equal(s.wellnessEyes, false);
    assert.equal(s.wellnessStretch, false);
    assert.deepEqual([s.wellnessWaterMin, s.wellnessPostureMin, s.wellnessEyesMin], [60, 45, 20]);
  });

  let panel;
  await step('a seção "Bem-estar" aparece com 3 lembretes e o alongar; intervalos desativados enquanto desligado', async () => {
    await main.ev(`window.mochi.openSettings()`);
    panel = track(await connect(await findTarget('panel')));
    await panel.waitFor(`!!(${FIELDSET})`, 'seção bem-estar');
    const n = await panel.ev(`(${FIELDSET}).querySelectorAll('input[type=checkbox]').length`);
    assert.equal(n, 4);
    const disabled = await panel.ev(`[...(${FIELDSET}).querySelectorAll('select')].every((s) => s.disabled)`);
    assert.equal(disabled, true);
  });

  await step('ligar "Beber água" habilita o intervalo e grava a preferência', async () => {
    await panel.ev(`(${FIELDSET}).querySelector('input[type=checkbox]').click()`);
    await panel.waitFor(`!(${FIELDSET}).querySelector('select').disabled`, 'intervalo habilitado');
    await panel.ev(`(() => { const s = (${FIELDSET}).querySelector('select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '90'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await panel.waitFor(`true`, 'ok');
    await sleep(300);
    const s = (await main.ev(`window.mochi.settings.get()`)).settings;
    assert.equal(s.wellnessWater, true);
    assert.equal(s.wellnessWaterMin, 90);
  });

  await step('valores inválidos são corrigidos para o intervalo permitido mais próximo', async () => {
    const r = await main.ev(`window.mochi.settings.update({ wellnessEyesMin: 3, wellnessPostureMin: 500, wellnessWaterMin: 'x', wellnessStretch: 'sim' })`);
    assert.equal(r.settings.wellnessEyesMin, 20);
    assert.equal(r.settings.wellnessPostureMin, 60);
    assert.equal(r.settings.wellnessWaterMin, 60, 'texto inválido volta ao padrão');
    assert.equal(r.settings.wellnessStretch, false);
  });

  await step('as escolhas sobrevivem ao reinício', async () => {
    await sleep(700); // gravação com atraso (debounce)
    closeAll();
    app.kill();
    await sleep(1500);
    launch();
    main = track(await connect(await findTarget('mascot')));
    await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
    const s = (await main.ev(`window.mochi.settings.get()`)).settings;
    assert.equal(s.wellnessWater, true);
    assert.equal(s.wellnessWaterMin, 60);
    assert.equal(s.wellnessPostureMin, 60);
    assert.equal(s.wellnessPosture, false);
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  closeAll();
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
