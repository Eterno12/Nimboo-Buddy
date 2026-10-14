/**
 * Teste de ponta a ponta do sistema de personagens no app REAL: troca pelo painel e pela API, o mesmo
 * rosto/estados em todos, nada cortado ao girar, persistência entre reinícios e configuração antiga/inválida.
 * Mesmas regras dos outros e2e: dados isolados (`--user-data-dir`), app compilado, sessão gráfica do Windows.
 *
 * Com `MOCHI_SHOTS=<pasta>` também grava capturas (galeria dos personagens em vários estados) para
 * inspeção visual.
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
const SHOTS = process.env.MOCHI_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const CHARACTERS = ['mochi', 'pineapple', 'square', 'mushroom', 'cactus', 'cloud', 'planet', 'ghost'];
const LABEL = {
  mochi: 'Nimboo',
  pineapple: 'Abacaxi',
  square: 'Quadrado',
  mushroom: 'Cogumelo',
  cactus: 'Cacto',
  cloud: 'Nuvem',
  planet: 'Planeta',
  ghost: 'Fantasma',
};

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

const dirs = [];
function newUserData(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-characters-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings));
  return dir;
}

/** Uma porta livre de verdade (o sistema escolhe): evita colidir com outro app ainda encerrando. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function launch(userData) {
  const port = await freePort();
  const proc = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
    stdio: 'ignore',
  });
  return { proc, port };
}

async function findTarget(port, hash, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
  const shot = async (file, clip) => {
    if (!SHOTS) return;
    const r = await call('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.result.data, 'base64'));
  };
  return { ev, click, move, waitFor, shot, call, close: () => ws.close() };
}

/** Abre o app, espera a ilha e devolve a janela do mascote. */
async function boot(userData) {
  const { proc, port } = await launch(userData);
  const page = await connect(await findTarget(port, 'mascot'));
  await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'island'`, 'ilha visível');
  await page.waitFor(`document.querySelector('.presence')?.getAnimations().length === 0`, 'entrada concluída');
  await page.move(176, 30);
  await page.ev(`window.mochi.settings.update({ hideDelaySec: 0, soundEnabled: false, bubbles: false })`);
  return { proc, port, page };
}

async function shutdown(proc) {
  proc.kill();
  await sleep(700);
}

const apps = [];
const conns = [];
try {
  console.log('Personagens — seleção, rostos compartilhados, sem cortes, persistência (app real, dados isolados)');

  const dataA = newUserData({ version: 3 });
  const a = await boot(dataA);
  apps.push(a.proc);
  const { page } = a;
  conns.push(page);
  const update = (patch) => page.ev(`window.mochi.settings.update(${JSON.stringify(patch)})`);
  const snapshot = () => page.ev(`window.mochi.settings.get()`);
  const svg = `document.querySelector('svg.mascot')`;

  await step('padrão: o Nimboo original, com rosto, folha e rótulo "Nimboo"', async () => {
    assert.equal((await snapshot()).settings.character, 'mochi');
    assert.equal(await page.ev(`${svg}.dataset.character`), 'mochi');
    assert.equal(await page.ev(`${svg}.getAttribute('aria-label')`), 'Nimboo');
    assert.equal(await page.ev(`!!${svg}.querySelector('.mascot-leaf')`), true);
    assert.equal(await page.ev(`${svg}.dataset.palette`), 'mint');
  });

  await step('os 8 personagens renderizam: corpo, rosto completo e gradientes válidos', async () => {
    for (const id of CHARACTERS) {
      await update({ character: id });
      await page.waitFor(`${svg}.dataset.character === '${id}'`, `${id} aplicado`);
      // espera a ilha assentar (a caixa do corpo para de mudar) antes de medir
      let prev = -1;
      for (let i = 0; i < 20; i++) {
        const w = await page.ev(`Math.round(${svg}.querySelector('.mascot-body').getBoundingClientRect().width * 10)`);
        if (w === prev) break;
        prev = w;
        await sleep(150);
      }
      const info = await page.ev(`(() => {
        const s = ${svg};
        const body = s.querySelector('.mascot-body');
        const b = body.getBoundingClientRect();
        const within = (el) => { const r = el.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1; };
        const faceParts = ['.mascot-cheek', '.face-eyes-open', '.face-mouth-smile'].map((q) => [...s.querySelectorAll(q)]).flat();
        const fill = body.getAttribute('fill');
        const gradId = fill.slice(5, -1);
        return {
          label: s.getAttribute('aria-label'),
          // área em unidades do viewBox (200), independente do tamanho na tela
          bodyArea: Math.round((b.width * b.height) / Math.pow(s.getBoundingClientRect().width / 200, 2)),
          faceInside: faceParts.every(within),
          faceParts: faceParts.length,
          states: ['eyes-open','eyes-happy','mouth-smile','mouth-open','mouth-o','mouth-sleep','mouth-flat','mouth-yawn'].every((n) => !!s.querySelector('.face-' + n)),
          gradient: !!document.getElementById(gradId),
          palette: s.dataset.palette ?? null,
        };
      })()`);
      assert.equal(info.label, LABEL[id], `${id} rótulo`);
      assert.ok(info.bodyArea > 4000, `${id} corpo ${info.bodyArea}`);
      assert.ok(info.states, `${id} tem todas as expressões`);
      assert.ok(info.gradient, `${id} gradiente do corpo existe`);
      assert.ok(info.faceInside, `${id}: o rosto cabe dentro do corpo`);
      assert.equal(info.palette, id === 'mochi' ? 'mint' : null, `${id} paleta`);
    }
  });

  await step('galeria visual: todos os personagens em vários estados (capturas)', async () => {
    await update({ character: 'mochi' });
    await page.ev(`window.mochi.openSettings()`);
    const panel = await connect(await findTarget(a.port, 'panel'));
    conns.push(panel);
    await panel.waitFor(`!!document.querySelector('.settings')`, 'configurações');
    await panel.waitFor(`document.querySelectorAll('.settings-character svg.mascot').length === 8`, '8 prévias');
    await panel.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1040, deviceScaleFactor: 1, mobile: false });
    const states = ['idle', 'happy', 'curious', 'sleepy', 'surprised', 'grabbed', 'annoyed', 'giggle', 'yawn'];
    await panel.ev(`(() => {
      const wrap = document.createElement('div');
      wrap.id = 'gallery';
      wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#fff;display:grid;grid-template-columns:repeat(9,110px);gap:2px;padding:8px;align-content:start';
      const previews = [...document.querySelectorAll('.settings-character svg.mascot')];
      for (const p of previews) for (const st of ${JSON.stringify(states)}) {
        const c = p.cloneNode(true);
        c.setAttribute('width', '110'); c.setAttribute('height', '110');
        c.dataset.state = st;
        c.style.background = '#f6f3ff';
        wrap.appendChild(c);
      }
      document.body.appendChild(wrap);
    })()`);
    await sleep(900);
    await panel.shot('gallery.png');
    await panel.ev(`document.getElementById('gallery').remove()`);
    await panel.call('Emulation.clearDeviceMetricsOverride');
  });

  await step('nada é cortado em nenhum estado: 8 personagens × 12 estados, medindo o contorno em 4 instantes da animação', async () => {
    const problems = [];
    const states = ['idle', 'happy', 'curious', 'sleepy', 'celebrate', 'surprised', 'grabbed', 'giggle', 'annoyed', 'stretch', 'yawn', 'lookaround'];
    for (const id of CHARACTERS) {
      await update({ character: id });
      await page.waitFor(`${svg}.dataset.character === '${id}'`, id);
      for (const state of states) {
        // reaplica o estado: o atributo reinicia as animações CSS do estado desde o começo
        await page.ev(`(() => { const s = ${svg}; s.dataset.state = 'idle'; void s.getBoundingClientRect(); s.dataset.state = '${state}'; })()`);
        for (let sample = 0; sample < 4; sample++) {
          await sleep(sample === 0 ? 60 : 160);
          const r = await page.ev(`(() => {
            const s = ${svg};
            const box = s.getBoundingClientRect();
            // getBoundingClientRect infla a caixa de formas giradas; mede-se pelos pontos reais do contorno.
            const unit = box.width / 200;
            let l = 1e9, t = 1e9, rr = -1e9, bb = -1e9, who = '';
            const take = (p, el) => {
              const nm = (el.getAttribute('class') || el.tagName) + ':' + (el.getAttribute('d') || '').slice(0, 14);
              if (p.x < l) { l = p.x; who = nm; }
              if (p.y < t) { t = p.y; who = nm; }
              if (p.x > rr) { rr = p.x; who = nm; }
              if (p.y > bb) { bb = p.y; who = nm; }
            };
            for (const el of s.querySelectorAll('path, circle, ellipse')) {
              if (el.closest('[clip-path], .mascot-sparkles, .mascot-zzz') || el.classList.contains('mascot-shadow')) continue;
              const m = el.getScreenCTM();
              if (!m) continue;
              const add = (x, y) => take(new DOMPoint(x, y).matrixTransform(m), el);
              if (el instanceof SVGPathElement) {
                const len = el.getTotalLength();
                const n = Math.max(16, Math.ceil(len / 4));
                for (let i = 0; i <= n; i++) { const p = el.getPointAtLength((len * i) / n); add(p.x, p.y); }
              } else {
                const g = (a) => parseFloat(el.getAttribute(a) || '0');
                const rx = el.tagName === 'circle' ? g('r') : g('rx');
                const ry = el.tagName === 'circle' ? g('r') : g('ry');
                for (let i = 0; i < 16; i++) { const a = (i / 16) * 2 * Math.PI; add(g('cx') + rx * Math.cos(a), g('cy') + ry * Math.sin(a)); }
              }
            }
            const pad = 1.5 * unit; // metade do contorno
            return { out: Math.max(box.left - l + pad, box.top - t + pad, rr - box.right + pad, bb - box.bottom + pad), size: box.width, who };
          })()`);
          if (r.out > 0.5) problems.push(`${id}/${state}: ${r.out.toFixed(1)}px (svg ${r.size}px) ${r.who}`);
        }
      }
    }
    assert.deepEqual([...new Set(problems)].slice(0, 12), [], `${problems.length} ocorrências de corte`);
  });
  await step('troca não quebra a interação: clicar na pílula abre e fecha a ilha com qualquer personagem', async () => {
    for (const id of ['cactus', 'ghost']) {
      await update({ character: id });
      await page.waitFor(`${svg}.dataset.character === '${id}'`, id);
      await page.click(176, 30);
      await page.waitFor(`document.querySelector('.shell').dataset.open === 'true'`, `ilha aberta com ${id}`);
      await page.click(176, 30);
      await page.waitFor(`document.querySelector('.shell').dataset.open === 'false'`, `ilha fechada com ${id}`);
    }
  });

  await step('valor inválido volta ao Nimboo; campos estranhos são ignorados', async () => {
    await update({ character: 'planet' });
    await page.waitFor(`${svg}.dataset.character === 'planet'`, 'planeta');
    const s = await update({ character: 'dragon', __proto__x: 1 });
    assert.equal(s.settings.character, 'mochi');
    await page.waitFor(`${svg}.dataset.character === 'mochi'`, 'voltou ao Nimboo');
    const t = await update({ character: 42 });
    assert.equal(t.settings.character, 'mochi');
  });

  await step('painel: a grade mostra os 8 com prévia; escolher troca na hora; "Restaurar padrões" volta ao Nimboo', async () => {
    await page.ev(`window.mochi.openSettings()`);
    const panel = await connect(await findTarget(a.port, 'panel'));
    conns.push(panel);
    await panel.waitFor(`!!document.querySelector('.settings')`, 'configurações');
    const names = await panel.ev(`[...document.querySelectorAll('[aria-label="Personagem"] [role=radio]')].map((b) => b.getAttribute('aria-label'))`);
    assert.deepEqual(names, CHARACTERS.map((id) => LABEL[id]));
    assert.equal(await panel.ev(`document.querySelectorAll('[aria-label="Personagem"] svg.mascot').length`), 8);
    assert.equal(await panel.ev(`document.querySelector('[aria-label="Personagem"] [aria-checked=true]').getAttribute('aria-label')`), 'Nimboo');
    await panel.ev(`document.querySelector('[data-character-id="ghost"]').click()`);
    await panel.waitFor(`document.querySelector('[data-character-id="ghost"]').getAttribute('aria-checked') === 'true'`, 'marcado');
    await page.waitFor(`${svg}.dataset.character === 'ghost'`, 'mascote trocou');
    assert.equal((await snapshot()).settings.character, 'ghost');
    await panel.shot('settings-panel.png');
    await panel.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Restaurar padrões').click()`);
    await page.waitFor(`${svg}.dataset.character === 'mochi'`, 'restaurou');
  });

  await step('persistência: o personagem escolhido sobrevive ao reinício do app', async () => {
    await update({ character: 'cloud' });
    await page.waitFor(`${svg}.dataset.character === 'cloud'`, 'nuvem');
    await sleep(600); // o main grava o arquivo logo depois da validação
    conns.splice(0).forEach((c) => c.close());
    await shutdown(a.proc);
    const b = await boot(dataA);
    apps.push(b.proc);
    conns.push(b.page);
    assert.equal((await b.page.ev(`window.mochi.settings.get()`)).settings.character, 'cloud');
    await b.page.waitFor(`document.querySelector('svg.mascot')?.dataset.character === 'cloud'`, 'nuvem ao reabrir');
    assert.equal(await b.page.ev(`document.querySelector('svg.mascot').getAttribute('aria-label')`), 'Nuvem');
    await b.page.shot('after-restart.png');
    b.page.close();
    await shutdown(b.proc);
  });

  await step('configuração antiga ou inválida abre com segurança no Nimboo original', async () => {
    for (const saved of [
      { version: 3, character: 'dragon' },
      { version: 3, character: 7 },
      { version: 2, mode: 'floating', color: 'rose' }, // sem o campo (versão anterior)
      { version: 1 },
    ]) {
      const dir = newUserData(saved);
      const c = await boot(dir);
      apps.push(c.proc);
      const s = await c.page.ev(`window.mochi.settings.get()`);
      assert.equal(s.settings.character, 'mochi', JSON.stringify(saved));
      await c.page.waitFor(`document.querySelector('svg.mascot')?.dataset.character === 'mochi'`, 'Nimboo');
      c.page.close();
      await shutdown(c.proc);
    }
  });

  await step('modo flutuante: o personagem escolhido aparece no canto e a janela mantém o tamanho', async () => {
    const dir = newUserData({ version: 3, character: 'cactus' });
    const c = await boot(dir);
    apps.push(c.proc);
    conns.push(c.page);
    await c.page.waitFor(`document.querySelector('svg.mascot')?.dataset.character === 'cactus'`, 'cacto na ilha');
    await c.page.ev(`window.mochi.settings.update({ hideDelaySec: 3 })`);
    await c.page.move(-30, -30);
    await c.page.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await c.page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'floating'`, 'Nimboo no canto', 40000);
    await c.page.waitFor(`window.outerWidth === 240 && window.outerHeight === 240`, 'janela do canto');
    assert.equal(await c.page.ev(`document.querySelector('svg.mascot').dataset.character`), 'cactus');
    await sleep(500);
    await c.page.shot('floating-cactus.png');
    c.page.close();
    await shutdown(c.proc);
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
  for (const p of apps) {
    try {
      p.kill();
    } catch {
      /* já encerrado */
    }
  }
  await sleep(600);
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* o sistema limpa a pasta temporária depois */
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);
