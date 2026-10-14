/**
 * Rotina do dia no app REAL: resumo da manhã (cartão nas tarefas + fala do Mochi), dispensar por hoje e
 * persistir entre reinícios, fechamento da noite (quando a hora já passou) e preferências.
 * Dados isolados; o horário do fechamento depende da hora do computador (o passo se adapta).
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
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-routine-'));
const settingsFile = path.join(userData, 'settings.json');
const writeSettings = (patch) =>
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: true, ...patch }),
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

let port = 9700;
let app = null;
const launch = () => {
  port = 9700 + Math.floor(Math.random() * 80);
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
const today = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

async function openTasks(main) {
  await main.ev(`window.mochi.openSettings()`);
  const panel = track(await connect(await findTarget('panel')));
  await panel.waitFor(`!!document.querySelector('.settings')`, 'configurações');
  await panel.ev(`document.querySelector('.settings-back').click()`);
  await panel.waitFor(`!!document.querySelector('.tasks')`, 'tarefas');
  return panel;
}

try {
  console.log('Rotina do dia — resumo, fechamento, dispensar e persistir (app real, dados isolados)');
  // Manhã isolada: fechamento desligado.
  writeSettings({ routineMorning: true, routineEvening: false });
  launch();
  let main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');

  const yesterday = new Date(Date.now() - 26 * 3600_000).toISOString();
  // ainda hoje (a menos de 1 h do fim do dia, fica em 23:59)
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 0, 0);
  const later = new Date(Math.min(Date.now() + 3600_000, endOfToday.getTime())).toISOString();
  await main.ev(`window.mochi.tasks.create('Pagar o boleto', ${JSON.stringify(yesterday)})`);
  await main.ev(`window.mochi.tasks.create('Enviar o relatório', ${JSON.stringify(later)})`);

  await step('o Mochi anuncia o resumo da manhã em um balão curto', async () => {
    await main.waitFor(
      `/tarefa\\(s\\)|Dia livre/.test(document.querySelector('.speech')?.textContent ?? '')`,
      'balão do resumo',
      20000,
    );
    const text = await main.ev(`document.querySelector('.speech').textContent`);
    assert.ok(text.length <= 56, text);
    assert.match(text, /^(Bom dia|Boa tarde|Boa noite|Madrugou)! 2 tarefa\(s\)/);
  });

  let panel;
  await step('o cartão "Resumo do dia" aparece nas tarefas com contagem e destaques', async () => {
    panel = await openTasks(main);
    await panel.waitFor(`!!document.querySelector('.day-card')`, 'cartão');
    const text = await panel.ev(`document.querySelector('.day-card').innerText`);
    assert.match(text, /2 tarefas pedem atenção/);
    assert.match(text, /1 atrasada/);
    const items = await panel.ev(`[...document.querySelectorAll('.day-card-highlights li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim())`);
    assert.ok(items[0].startsWith('Pagar o boleto') && items[0].includes('atrasada'), JSON.stringify(items));
    assert.ok(items.some((i) => i.startsWith('Enviar o relatório')));
  });

  await step('dispensar marca o dia como visto e some o cartão', async () => {
    await panel.ev(`document.querySelector('.day-card-close').click()`);
    await panel.waitFor(`!document.querySelector('.day-card')`, 'cartão some');
    const s = await main.ev(`window.mochi.settings.get()`);
    assert.equal(s.settings.routineLastMorning, today);
  });

  await step('ao reiniciar no mesmo dia o resumo NÃO volta; no dia seguinte voltaria (chave por data)', async () => {
    await sleep(700); // as preferências são gravadas com um pequeno atraso (debounce)
    closeAll();
    app.kill();
    await sleep(1500);
    launch();
    main = track(await connect(await findTarget('mascot')));
    await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
    await sleep(4500); // dá tempo de o anúncio acontecer, se fosse acontecer
    const spoken = await main.ev(`document.querySelector('.speech')?.textContent ?? ''`);
    assert.equal(/tarefa\(s\)|Dia livre/.test(spoken), false, `falou o resumo de novo: ${spoken}`);
    const p = await openTasks(main);
    await sleep(800);
    const cardText = await p.ev(`document.querySelector('.day-card')?.innerText ?? ''`);
    assert.equal(cardText, '', `o cartão voltou: ${cardText}`);
    // simula "ontem": o resumo volta
    await main.ev(`window.mochi.settings.update({ routineLastMorning: '2000-01-01' })`);
    await p.waitFor(`!!document.querySelector('.day-card')`, 'cartão volta em um dia novo');
  });

  await step('preferências inválidas são corrigidas (hora do fechamento, datas)', async () => {
    const s = await main.ev(`window.mochi.settings.update({ routineEveningHour: 3, routineLastEvening: 'ontem', routineMorning: 'sim' })`);
    assert.equal(s.settings.routineEveningHour, 17, 'vira a hora permitida mais próxima');
    assert.equal(s.settings.routineLastEvening, null);
    assert.equal(s.settings.routineMorning, true);
    const t = await main.ev(`window.mochi.settings.update({ routineEveningHour: 20 })`);
    assert.equal(t.settings.routineEveningHour, 20);
  });

  await step('fechamento: quando a hora já passou, o cartão da noite substitui o da manhã', async () => {
    const hour = new Date().getHours();
    if (hour < 17) {
      console.log('       (pulado: ainda antes das 17h neste computador)');
      return;
    }
    await main.ev(`window.mochi.settings.update({ routineEvening: true, routineEveningHour: 17, routineLastEvening: null, routineLastMorning: null })`);
    const p = (conns.find(() => true), await openTasks(main));
    await p.waitFor(`document.querySelector('.day-card')?.dataset.kind === 'evening'`, 'cartão da noite');
    const text = await p.ev(`document.querySelector('.day-card').innerText`);
    assert.match(text, /Boa noite!/);
    assert.match(text, /concluiu|nenhuma tarefa foi concluída/);
    await p.ev(`document.querySelector('.day-card-close').click()`);
    await p.waitFor(`document.querySelector('.day-card')?.dataset.kind !== 'evening'`, 'noite dispensada');
    assert.equal((await main.ev(`window.mochi.settings.get()`)).settings.routineLastEvening, today);
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
