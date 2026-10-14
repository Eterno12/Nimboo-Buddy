/**
 * Vínculo e conquistas no app REAL: conquista ao concluir uma tarefa, aviso (toast) na tela, janela de
 * conquistas (perfil, filtros), nome do personagem, eventos inválidos ignorados e persistência entre
 * reinícios (sem repetir o aviso, afeto guardado). Dados isolados.
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-bond-'));
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: false, routineMorning: false, routineEvening: false }),
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

try {
  console.log('Vínculo e conquistas — troféus, aviso, janela, nome e persistência (app real, dados isolados)');
  launch();
  let main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');

  await step('começa sem a conquista de tarefa e com os dias juntos contados', async () => {
    const s = await main.ev(`window.mochi.bond.get()`);
    assert.ok(s.total >= 20, `total ${s.total}`);
    assert.equal(s.achievements.find((a) => a.id === 'first_task').unlocked, false);
    assert.ok((s.stats.days_total ?? 0) >= 1, 'dia de hoje contado');
  });

  await step('concluir uma tarefa libera "Primeira tarefa" e mostra o aviso na tela', async () => {
    const created = await main.ev(`window.mochi.tasks.create('Teste de conquista', null)`);
    assert.ok(created.ok, JSON.stringify(created));
    const done = await main.ev(`window.mochi.tasks.complete(${JSON.stringify(created.value.id)})`);
    assert.ok(done.ok, JSON.stringify(done));
    await main.waitFor(
      `window.mochi.bond.get().then((s) => s.achievements.find((a) => a.id === 'first_task').unlocked)`,
      'conquista liberada',
    );
    const toast = track(await connect(await findTarget('toast=first_task')));
    await toast.waitFor(`document.querySelector('.ach-toast')?.innerText.includes('Primeira tarefa')`, 'texto do aviso');
    const text = await toast.ev(`document.querySelector('.ach-toast').innerText`);
    assert.match(text, /conquista desbloqueada/i);
    assert.match(text, /\+10 pts/);
    const bg = await toast.ev(`getComputedStyle(document.documentElement).backgroundColor`);
    assert.match(bg, /rgba\(0, 0, 0, 0\)|transparent/, `fundo do aviso não é transparente: ${bg}`);
  });

  await step('o aviso fecha sozinho depois de alguns segundos', async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 9000) {
      if (!(await hasTarget('toast=first_task'))) return;
      await sleep(250);
    }
    throw new Error('o aviso continuou aberto');
  });

  let win;
  await step('a janela de conquistas mostra perfil, pontos e a conquista liberada', async () => {
    await main.ev(`window.mochi.bond.open()`);
    win = track(await connect(await findTarget('achievements')));
    await win.waitFor(`!!document.querySelector('.ach-profile h1')`, 'perfil');
    assert.equal(await win.ev(`document.querySelector('.ach-profile h1').textContent`), 'Mochi');
    const score = await win.ev(`document.querySelector('.ach-score strong').textContent`);
    assert.ok(Number(score) >= 10, `pontos ${score}`);
    const tile = await win.ev(
      `(() => { const t = [...document.querySelectorAll('.ach-tile')].find((x) => x.innerText.includes('Primeira tarefa')); return t ? t.dataset.unlocked : null; })()`,
    );
    assert.equal(tile, 'true');
  });

  await step('filtros: "Conquistadas" só mostra as liberadas e "Bloqueadas" só as demais', async () => {
    await win.ev(`[...document.querySelectorAll('.ach-filter')].find((b) => b.textContent === 'Conquistadas').click()`);
    await sleep(150);
    const unlocked = await win.ev(`[...document.querySelectorAll('.ach-tile')].every((t) => t.dataset.unlocked === 'true')`);
    assert.equal(unlocked, true);
    await win.ev(`[...document.querySelectorAll('.ach-filter')].find((b) => b.textContent === 'Bloqueadas').click()`);
    await sleep(150);
    const locked = await win.ev(
      `(() => { const l = [...document.querySelectorAll('.ach-tile')]; return l.length > 0 && l.every((t) => t.dataset.unlocked === 'false'); })()`,
    );
    assert.equal(locked, true);
  });

  await step('conquistas secretas aparecem como "???" enquanto bloqueadas', async () => {
    const s = await main.ev(`window.mochi.bond.get()`);
    const hidden = s.achievements.filter((a) => a.hidden);
    assert.ok(hidden.length >= 1, 'há conquistas secretas');
    for (const a of hidden) {
      assert.equal(a.title, '???');
      assert.equal(a.description, 'Conquista secreta.');
    }
  });

  await step('o nome do personagem aparece na janela e é validado', async () => {
    await main.ev(`window.mochi.settings.update({ mascotName: '  Bolinho  ' })`);
    await win.waitFor(`document.querySelector('.ach-profile h1')?.textContent === 'Bolinho'`, 'nome novo');
    const bad = await main.ev(`window.mochi.settings.update({ mascotName: '<img>' })`);
    assert.equal(bad.settings.mascotName, 'Mochi', 'nome inválido volta ao padrão, nunca é gravado');
  });

  await step('carinho conta; eventos desconhecidos ou que só o app pode gerar são ignorados', async () => {
    const before = (await main.ev(`window.mochi.bond.get()`)).stats;
    await main.ev(`(() => { window.mochi.bond.event('pet'); window.mochi.bond.event('pet'); })()`);
    // @ts-ignore: simula uma interface adulterada enviando tipos que não são dela
    await main.ev(`(() => { window.mochi.bond.event('task_completed'); window.mochi.bond.event('focus_finished'); window.mochi.bond.event('hack'); })()`);
    await sleep(400);
    const after = (await main.ev(`window.mochi.bond.get()`)).stats;
    assert.equal((after.pets ?? 0) - (before.pets ?? 0), 2);
    assert.equal(after.tasks_completed ?? 0, before.tasks_completed ?? 0);
    assert.equal(after.focus_sessions ?? 0, before.focus_sessions ?? 0);
  });

  await step('o afeto e as conquistas sobrevivem ao reinício, sem repetir o aviso', async () => {
    await main.ev(`window.mochi.bond.saveAffection(0.9)`);
    await sleep(500);
    closeAll();
    app.kill();
    await sleep(1500);
    launch();
    main = track(await connect(await findTarget('mascot')));
    await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
    const s = await main.ev(`window.mochi.bond.get()`);
    assert.equal(s.achievements.find((a) => a.id === 'first_task').unlocked, true);
    assert.ok(s.affection > 0.85, `afeto ${s.affection}`);
    assert.equal(s.stats.tasks_completed, 1);
    await sleep(2500);
    assert.equal(await hasTarget('toast=first_task'), false, 'o aviso não deve voltar');
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
