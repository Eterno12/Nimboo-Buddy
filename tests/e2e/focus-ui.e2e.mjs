/**
 * Teste de ponta a ponta do modo foco, dirigindo o app REAL (Electron) pelo CDP.
 * Não usa o mouse do sistema; usa um diretório de dados temporário (o banco real não é tocado).
 * Exige o app compilado (`npm run build`) e uma sessão gráfica do Windows.
 * Dura ~1,5 min: inclui uma sessão real de 1 minuto até o fim, com a ilha escondida.
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
const PORT = 9500 + Math.floor(Math.random() * 40);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-focus-'));
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ version: 2, mode: 'island', floating: null, displayId: null }),
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
  const key = async (k) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k });
  };
  const move = (x, y) => call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const waitFor = async (expression, label, timeoutMs = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(80);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  return { ev, click, key, move, waitFor, close: () => ws.close() };
}

let page;
try {
  console.log('Modo foco — interface e ciclo completo (app real, dados isolados)');
  page = await connect(await findTarget('mascot'));
  await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'island'`, 'ilha visível');
  // A ilha cresce a partir da linha do topo (clip-path): só interage depois da entrada terminar.
  await page.waitFor(`document.querySelector('.presence')?.getAnimations().length === 0`, 'entrada concluída');

  const text = (sel) => page.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
  const keepAlive = () => page.move(176, 120);
  const center = (sel) =>
    page.ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  /** Clica no centro do elemento, depois de ele estar de fato acessível (o recorte da ilha também recorta cliques). */
  const clickSel = async (sel) => {
    const t0 = Date.now();
    for (;;) {
      const [x, y] = await center(sel);
      const hit = await page.ev(
        `!!document.elementFromPoint(${x}, ${y})?.closest(${JSON.stringify(sel)})`,
      );
      if (hit) return page.click(x, y);
      if (Date.now() - t0 > 4000) throw new Error(`elemento não acessível para clique: ${sel}`);
      await sleep(80);
    }
  };
  const state = () => page.ev(`window.mochi.focus.getState()`);

  await step('atalho de foco abre a tela de foco (repouso, 25 min por padrão)', async () => {
    await page.click(176, 28);
    await page.waitFor(`document.querySelector('.shell').dataset.open === 'true'`, 'ilha aberta');
    await sleep(450);
    await clickSel('.island-shortcuts li:nth-child(2) button');
    await page.waitFor(`document.querySelector('.shell').dataset.view === 'focus'`, 'tela de foco');
    await page.waitFor(`!!document.querySelector('.focus-chip')`, 'seletor de duração');
    assert.equal(await page.ev(`document.querySelector('.focus-chip[aria-checked=true]').textContent`), '25 min');
    assert.equal((await state()).status, 'idle');
  });

  await step('entradas inválidas são recusadas pelo main (sem sessão criada)', async () => {
    for (const [kind, min] of [['focus', 0], ['focus', 181], ['focus', 1.5], ['x', 5], ['break', 61]]) {
      const r = await page.ev(`window.mochi.focus.start(${JSON.stringify(kind)}, ${min})`);
      assert.equal(r.ok, false, `${kind}/${min} deveria falhar`);
    }
    assert.equal((await state()).status, 'idle');
  });

  await step('iniciar: relógio corre, barra de progresso e botão vira "Pausar"', async () => {
    await keepAlive();
    await clickSel('.focus-actions .tasks-add');
    await page.waitFor(`!!document.querySelector('.focus-clock')`, 'relógio');
    assert.match(await text('.focus-clock'), /^2[45]:\d\d$/);
    assert.equal((await state()).status, 'running');
    assert.equal(await text('.focus-actions .tasks-add'), 'Pausar');
    const first = await text('.focus-clock');
    await sleep(2200);
    assert.notEqual(await text('.focus-clock'), first, 'o relógio deve andar');
  });

  await step('pausar congela; retomar continua do mesmo ponto', async () => {
    await keepAlive();
    await clickSel('.focus-actions .tasks-add');
    await page.waitFor(`document.querySelector('.focus-clock')?.dataset.status === 'paused'`, 'pausado');
    const frozen = await text('.focus-clock');
    await sleep(2100);
    assert.equal(await text('.focus-clock'), frozen);
    assert.equal(await text('.focus-actions .tasks-add'), 'Retomar');
    await clickSel('.focus-actions .tasks-add');
    await page.waitFor(`document.querySelector('.focus-clock')?.dataset.status === 'running'`, 'retomado');
    await sleep(1500);
    assert.notEqual(await text('.focus-clock'), frozen);
  });

  await step('não permite iniciar outra sessão por cima de uma em andamento', async () => {
    const r = await page.ev(`window.mochi.focus.start('focus', 5)`);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'busy');
  });

  await step('recolher a ilha mostra o tempo restante na pílula (selo)', async () => {
    await page.key('Escape');
    await page.waitFor(`document.querySelector('.shell').dataset.open === 'false'`, 'ilha recolhida');
    await page.waitFor(`!!document.querySelector('.focus-badge')`, 'selo');
    assert.match(await text('.focus-badge'), /^\d\d:\d\d$/);
  });

  await step('cancelar volta ao repouso e some o selo', async () => {
    await page.ev(`window.mochi.focus.cancel()`);
    await page.waitFor(`!document.querySelector('.focus-badge')`, 'selo removido');
    assert.equal((await state()).status, 'idle');
  });

  await step('ciclo completo: 1 min com a ilha escondida; ao fim a ilha volta e comemora', async () => {
    const started = await page.ev(`window.mochi.focus.start('focus', 1)`);
    assert.equal(started.ok, true);
    await page.move(-30, -30); // sem hover: a ilha pode se esconder
    // Some da tela (fica longe da ilha) e só volta ao terminar a sessão.
    await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'floating'`, 'Mochi no canto', 30000);
    // O cursor real do sistema pode estar na borda superior e trazer a ilha antes; o essencial é o
    // que acontece ao FIM da sessão, então espera o estado "finished" primeiro.
    await page.waitFor(`window.mochi.focus.getState().then((s) => s.status === 'finished')`, 'sessão concluída', 80000);
    await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'island'`, 'ilha voltou ao fim', 8000);
    try {
      await page.waitFor(`document.querySelector('.shell').dataset.view === 'focus'`, 'tela de foco aberta', 6000);
      await page.waitFor(`document.querySelector('.shell').dataset.open === 'true'`, 'ilha aberta', 6000);
    } catch (error) {
      const dump = await page.ev(`JSON.stringify({ds:{...document.querySelector('.shell').dataset},anims:document.querySelector('.presence').getAnimations().length})`);
      throw new Error(`${error.message} :: ${dump} :: ${JSON.stringify(await state())}`);
    }
    assert.match(await text('.focus-done'), /concluída/);
    assert.equal((await state()).status, 'finished');
  });

  await step('depois do foco, "Pausa de 5 min" inicia a pausa; dispensar volta ao repouso', async () => {
    await keepAlive();
    await sleep(400);
    await clickSel('.focus-actions .tasks-add');
    await page.waitFor(`document.querySelector('.focus-clock')?.dataset.status === 'running'`, 'pausa correndo');
    const s = await state();
    assert.equal(s.kind, 'break');
    assert.equal(s.durationMs, 5 * 60_000);
    await page.ev(`window.mochi.focus.cancel()`);
    await page.waitFor(`!document.querySelector('.focus-clock')`, 'repouso');
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
    /* arquivos ainda em uso: o sistema limpa a pasta temporária depois */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);
