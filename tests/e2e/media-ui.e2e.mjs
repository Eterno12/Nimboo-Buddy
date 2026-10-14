/**
 * Player de música da ilha no app REAL, sem tocar nada: o "que está tocando" vem de um arquivo
 * (MOCHI_E2E_MEDIA_FIXTURE, só em app não empacotado) e os comandos são anotados em <arquivo>.commands.
 * Cobre: reduzido sem música, expande ao tocar, controles, reação do Nimboo, desligar e a forma da janela.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-media-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: false }));
const fixture = path.join(userData, 'media.json');
const write = (obj) => fs.writeFileSync(fixture, JSON.stringify(obj));
write({ status: 'none' });

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
const app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  stdio: 'ignore',
  env: { ...process.env, MOCHI_E2E_MEDIA_FIXTURE: fixture },
});

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
    const d = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (d.result?.exceptionDetails) {
      const x = d.result.exceptionDetails;
      throw new Error(`erro no navegador: ${x.exception?.description ?? x.text} :: ${expression.slice(0, 100)}`);
    }
    return d.result?.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  const click = async (x, y) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  return { ev, waitFor, click, close: () => ws.close() };
}

/** Quanto do desenho da ilha fica escondido embaixo (px do recorte `inset(... bottom ...)`). */
const clipBottom = (page) =>
  page.ev(`(() => { const m = /inset\\(\\s*[\\d.]+(?:px)?\\s+[\\d.]+(?:px)?\\s+([\\d.]+)px/.exec(getComputedStyle(document.querySelector('.island')).clipPath); return m ? Number(m[1]) : -1; })()`);

let page;
try {
  console.log('Player de música — reduzido, expande ao tocar, controles e reação (app real, sem rede)');
  page = await connect(await findTarget('mascot'));
  await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'island'`, 'ilha visível');
  await page.waitFor(`document.querySelector('.presence')?.getAnimations().length === 0`, 'entrada concluída');

  await step('com a ilha aberta e nada tocando, o player aparece reduzido (uma linha)', async () => {
    await page.click(176, 28);
    await page.waitFor(`document.querySelector('.shell').dataset.open === 'true'`, 'ilha aberta');
    await page.waitFor(`document.querySelector('.island-media')?.dataset.layout === 'mini'`, 'player reduzido');
    assert.equal(await page.ev(`document.querySelector('.shell').dataset.media`), 'mini');
    const text = await page.ev(`document.querySelector('.island-media').innerText`);
    assert.match(text, /Nada tocando agora/);
    await sleep(500);
    assert.equal(await clipBottom(page), 242, 'forma da ilha com o player reduzido (430 - 188)');
  });

  await step('ao tocar, o player expande com título, artista, app e progresso', async () => {
    write({
      status: 'Playing',
      title: 'Garota de Ipanema',
      artist: 'Tom Jobim',
      album: 'Getz/Gilberto',
      app: 'Spotify.exe',
      position: 20,
      duration: 180,
      canPlayPause: true,
      canNext: true,
      canPrev: true,
      canSeek: true,
    });
    await page.waitFor(`document.querySelector('.island-media')?.dataset.layout === 'playing'`, 'player aberto');
    const text = await page.ev(`document.querySelector('.island-media').innerText`);
    assert.match(text, /Garota de Ipanema/);
    assert.match(text, /Tom Jobim · Spotify/);
    assert.match(text, /3:00/);
    await sleep(700);
    assert.equal(await clipBottom(page), 154, 'forma da ilha com música tocando (430 - 276)');
    // a janela cresceu junto: o player está todo dentro da forma visível
    const fits = await page.ev(`(() => { const c = document.querySelector('.island-media').getBoundingClientRect(); const s = document.querySelector('.shell').getBoundingClientRect(); return c.bottom <= s.top + 276 + 1; })()`);
    assert.equal(fits, true);
  });

  await step('o Nimboo reage à música enquanto toca', async () => {
    assert.equal(await page.ev(`document.querySelector('.shell').dataset.music`), 'true');
    const animated = await page.ev(`getComputedStyle(document.querySelector('.shell-stage')).animationName`);
    assert.match(animated, /music-bob/); // o Nimboo sempre anima (D12); a opção "balançar" desliga
  });

  await step('controles: tocar/pausar, próxima e anterior chegam ao Windows', async () => {
    await page.ev(`document.querySelector('[data-testid="media-toggle"]').click()`);
    await page.ev(`document.querySelector('[data-testid="media-next"]').click()`);
    await page.ev(`document.querySelector('[data-testid="media-prev"]').click()`);
    const t0 = Date.now();
    let lines = [];
    while (Date.now() - t0 < 5000) {
      try {
        lines = fs.readFileSync(`${fixture}.commands`, 'utf8').trim().split('\n').map((l) => JSON.parse(l).type);
      } catch {
        lines = [];
      }
      if (lines.length >= 3) break;
      await sleep(100);
    }
    assert.deepEqual(lines, ['toggle', 'next', 'prev']);
  });

  await step('clicar na barra de progresso pede para ir àquele ponto da faixa', async () => {
    await page.ev(`(() => { const b = document.querySelector('.media-bar'); const r = b.getBoundingClientRect(); b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 2 })); })()`);
    const t0 = Date.now();
    let seek = null;
    while (Date.now() - t0 < 5000 && !seek) {
      const all = fs.readFileSync(`${fixture}.commands`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      seek = all.find((c) => c.type === 'seek') ?? null;
      await sleep(100);
    }
    assert.ok(seek, 'seek não foi enviado');
    assert.ok(Math.abs(seek.seconds - 90) < 8, `seek ${seek.seconds}`);
  });

  await step('pausar reduz o player de novo e o Nimboo para de balançar', async () => {
    write({ status: 'Paused', title: 'Garota de Ipanema', artist: 'Tom Jobim', duration: 180, position: 40, canPlayPause: true });
    await page.waitFor(`document.querySelector('.island-media')?.dataset.layout === 'mini'`, 'reduzido');
    assert.equal(await page.ev(`document.querySelector('.shell').dataset.music`), 'false');
    const text = await page.ev(`document.querySelector('.island-media').innerText`);
    assert.match(text, /Garota de Ipanema — Tom Jobim \(pausado\)/);
    await sleep(700);
    assert.equal(await clipBottom(page), 242);
  });

  await step('desligar o player some com o cartão e devolve a ilha ao tamanho simples', async () => {
    await page.ev(`window.mochi.settings.update({ mediaPlayer: false })`);
    await page.waitFor(`!document.querySelector('.island-media')`, 'cartão some');
    assert.equal(await page.ev(`document.querySelector('.shell').dataset.media`), 'off');
    await sleep(700);
    assert.equal(await clipBottom(page), 266, 'forma simples (430 - 164)');
    const state = await page.ev(`window.mochi.media.get()`);
    assert.equal(state.available, false, 'o leitor foi parado');
  });

  await step('reação ao desligar "balançar": toca música mas o Nimboo fica parado', async () => {
    await page.ev(`window.mochi.settings.update({ mediaPlayer: true, mediaReact: false })`);
    write({ status: 'Playing', title: 'Outra', artist: 'Alguém', duration: 100, position: 1, canPlayPause: true });
    await page.waitFor(`document.querySelector('.island-media')?.dataset.layout === 'playing'`, 'tocando de novo');
    assert.equal(await page.ev(`document.querySelector('.shell').dataset.music`), 'false');
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  page?.close();
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
