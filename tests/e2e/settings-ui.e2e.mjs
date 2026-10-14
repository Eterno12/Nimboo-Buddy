/**
 * Teste de ponta a ponta das configurações (tamanhos, cor, balões, validação) no app REAL.
 * Mesmas regras dos outros e2e: dados isolados (`--user-data-dir`), nada de mouse do sistema,
 * app compilado e sessão gráfica do Windows.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-settings-'));
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  // Começa salvo como "flutuante": o app precisa abrir como ilha mesmo assim.
  JSON.stringify({ version: 3, mode: 'floating', floating: { x: 300, y: 300 }, displayId: null }),
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
let panel;
try {
  console.log('Configurações — tamanhos, cor, balões e validação (app real, dados isolados)');
  page = await connect(await findTarget('mascot'));
  await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'island'`, 'ilha visível');
  await page.waitFor(`document.querySelector('.presence')?.getAnimations().length === 0`, 'entrada concluída');

  // O ponteiro sobre a pílula impede que a ilha se esconda durante os primeiros passos, e "nunca
  // esconder" (preferência) deixa os passos independentes de tempo; o passo do canto religa.
  await page.move(176, 30);
  await page.ev(`window.mochi.settings.update({ hideDelaySec: 0 })`);

  const snapshot = () => page.ev(`window.mochi.settings.get()`);
  const update = (patch) => page.ev(`window.mochi.settings.update(${JSON.stringify(patch)})`);

  await step('padrões: ilha 100%, Nimboo 100%, cor menta, sons e balões ligados, atalho ativo', async () => {
    const s = await snapshot();
    assert.equal(s.settings.islandScale, 1);
    assert.equal(s.settings.mochiScale, 1);
    assert.equal(s.settings.color, 'mint');
    assert.equal(s.settings.soundEnabled, true);
    assert.equal(s.settings.bubbles, true);
    assert.equal(s.settings.launchAtLogin, false, 'iniciar com o Windows nunca vem ligado');
    assert.equal(s.packaged, false);
    assert.equal(await page.ev('window.outerWidth'), 352);
  });

  await step('abre sempre como ilha, mesmo com o modo flutuante salvo', async () => {
    assert.equal(await page.ev(`document.querySelector('.shell').dataset.mode`), 'island');
    assert.equal((await snapshot()).settings.mode, 'island');
  });

  await step('balão: o Nimboo cumprimenta ao chegar e o balão some sozinho', async () => {
    await page.waitFor(`!!document.querySelector('.speech')`, 'balão de boas-vindas', 6000);
    const text = await page.ev(`document.querySelector('.speech').textContent`);
    assert.ok(text.length > 0 && text.length <= 40, text);
    await page.waitFor(`!document.querySelector('.speech')`, 'balão some', 9000);
  });

  await step('tamanho da ilha 125%: a janela e o conteúdo crescem juntos', async () => {
    const s = await update({ islandScale: 1.25 });
    assert.equal(s.settings.islandScale, 1.25);
    assert.equal(s.effective.islandScale, 1.25);
    await page.waitFor(`window.outerWidth === 440 && window.outerHeight === 475`, 'janela ampliada');
    const w = await page.ev(`Math.round(document.querySelector('.island-shadow').getBoundingClientRect().width)`);
    assert.equal(w, 420, 'a pílula 336 × 1,25');
    assert.equal(await page.ev(`getComputedStyle(document.querySelector('.shell')).getPropertyValue('--ui-scale').trim()`), '1.25');
  });

  await step('ilha ampliada: clicar na pílula abre e a tela de atalhos fica acessível', async () => {
    await page.click(220, 35); // centro da pílula compacta ampliada
    await page.waitFor(`document.querySelector('.shell').dataset.open === 'true'`, 'ilha aberta');
    await page.waitFor(
      `(() => { const b = document.querySelector('.island-shortcut'); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.island-shortcut') === b; })()`,
      'atalho clicável',
    );
  });

  await step('valores inválidos são ajustados no main; campos que não são preferências são ignorados', async () => {
    const s = await update({
      islandScale: 99,
      color: 'neon',
      shortcut: 'Control+Alt+Delete',
      mode: 'floating',
      displayId: 12345,
      launchAtLogin: 'sim',
      evil: true,
    });
    assert.equal(s.settings.islandScale, 1.4, 'vira o passo permitido mais próximo');
    assert.equal(s.settings.color, 'mint', 'cor inválida volta ao padrão');
    assert.equal(s.settings.shortcut, 'Control+Alt+M');
    assert.equal(s.settings.mode, 'island', 'o modo não é editável por este canal');
    assert.equal(s.settings.displayId, null);
    assert.equal(s.settings.launchAtLogin, false);
    assert.ok(!('evil' in s.settings));
    await update({ islandScale: 1 });
    await page.waitFor(`window.outerWidth === 352`, 'volta a 100%');
  });

  await step('cor: trocar a paleta muda as cores do SVG na hora', async () => {
    await update({ color: 'peach' });
    await page.waitFor(`document.querySelector('svg.mascot')?.dataset.palette === 'peach'`, 'paleta aplicada');
    const stop = await page.ev(
      `getComputedStyle(document.querySelector('#mochi-body stop')).stopColor`,
    );
    assert.match(stop, /rgb\(255, 234, 219\)|#ffeadb/i);
    await update({ color: 'mint' });
  });

  await step('balões desligados: nenhuma fala aparece; religar volta a permitir', async () => {
    await update({ bubbles: false });
    await sleep(300);
    assert.equal(await page.ev(`!!document.querySelector('.speech')`), false);
    await update({ bubbles: true });
  });

  await step('painel nas configurações: abre pela engrenagem e altera o tamanho do Nimboo', async () => {
    await page.ev(`window.mochi.openSettings()`);
    panel = await connect(await findTarget('panel'));
    await panel.waitFor(`!!document.querySelector('.settings')`, 'tela de configurações');
    // Clica no passo "140%" do grupo "Tamanho do Nimboo solto".
    await panel.ev(
      `[...document.querySelectorAll('[aria-label="Tamanho do Nimboo solto"] button')].find((b) => b.textContent === '140%').click()`,
    );
    await panel.waitFor(
      `[...document.querySelectorAll('[aria-label="Tamanho do Nimboo solto"] [aria-checked=true]')].map((b) => b.textContent).join() === '140%'`,
      'passo marcado',
    );
    const s = await snapshot();
    assert.equal(s.settings.mochiScale, 1.4);
  });

  await step('Nimboo no canto usa o tamanho do Nimboo solto (240 × 1,4 = 336)', async () => {
    await page.ev(`document.querySelector('.island-gear')?.blur?.()`);
    // A ilha se esconde sozinha depois de recolher: tira o ponteiro de cima e fecha a ilha (Esc).
    await update({ hideDelaySec: 3 });
    await page.move(-30, -30);
    await page.ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'floating'`, 'Nimboo no canto', 40000);
    await page.waitFor(`window.outerWidth === 336 && window.outerHeight === 336`, 'janela do Nimboo ampliada', 4000);
    const svgW = await page.ev(`Math.round(document.querySelector('svg.mascot').getBoundingClientRect().width)`);
    assert.ok(svgW >= 330 && svgW <= 340, `svg ${svgW}`);
  });

  await step('restaurar padrões (pelo painel) volta tudo ao normal', async () => {
    await panel.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Restaurar padrões').click()`);
    await panel.waitFor(
      `[...document.querySelectorAll('[aria-label="Tamanho do Nimboo solto"] [aria-checked=true]')].map((b) => b.textContent).join() === '100%'`,
      'voltou a 100%',
      12000,
    );
    await page.waitFor(`window.outerWidth === 240`, 'janela do Nimboo em 240', 12000);
  });

  await step('prazo: datas inválidas são recusadas e um prazo válido é gravado em UTC', async () => {
    const bad = await page.ev(`window.mochi.tasks.create('x', 'ontem à noite')`);
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, 'invalid_due');
    const old = await page.ev(`window.mochi.tasks.create('x', '1990-01-01T00:00:00Z')`);
    assert.equal(old.ok, false);
    const due = new Date(Date.now() + 3 * 3600_000).toISOString();
    const ok = await page.ev(`window.mochi.tasks.create('Tarefa com prazo', ${JSON.stringify(due)})`);
    assert.equal(ok.ok, true);
    assert.equal(ok.value.dueAt, due);
    const cleared = await page.ev(`window.mochi.tasks.setDue(${JSON.stringify(ok.value.id)}, null)`);
    assert.equal(cleared.ok, true);
    assert.equal(cleared.value.dueAt, null);
  });

  await step('lembrete: na hora marcada o Nimboo mostra o balão com o nome da tarefa', async () => {
    await update({ remindersEnabled: true, reminderLeadMin: 0, bubbles: true });
    const due = new Date(Date.now() + 65_000).toISOString();
    const r = await page.ev(`window.mochi.tasks.create('Revisar a proposta', ${JSON.stringify(due)})`);
    assert.equal(r.ok, true);
    await page.waitFor(
      `(document.querySelector('.speech')?.textContent ?? '').includes('Chegou a hora: Revisar a proposta')`,
      'balão do lembrete',
      100000,
    );
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  for (const p of [page, panel]) {
    try {
      p?.close();
    } catch {
      /* já fechado */
    }
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
