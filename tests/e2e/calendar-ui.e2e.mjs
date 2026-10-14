/**
 * Teste de ponta a ponta da agenda (iCal) no app REAL, SEM rede: o gancho de testes
 * `MOCHI_E2E_CALENDAR_FILE` (só em app não empacotado) entrega um arquivo local no lugar do download.
 * Cobre: endereço inválido, conexão, "Agenda de hoje", lembrete de evento, o endereço nunca voltar à
 * interface, persistência criptografada entre execuções e remoção.
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
const PORT = 9700 + Math.floor(Math.random() * 40);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-cal-'));
fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify({ version: 3, reminderLeadMin: 0, remindersEnabled: true, hideDelaySec: 0 }),
);

const SECRET_URL = 'https://calendar.google.com/calendar/ical/teste%40gmail.com/private-segredo9876/basic.ics';
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const now = new Date();
const soon = new Date(now.getTime() + 45_000);
const past = new Date(now.getTime() - 3 * 3600_000);
const later = new Date(now.getTime() + 2 * 3600_000);
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const tomorrow = new Date(todayStart.getTime() + 36 * 3600_000);
const vevent = (uid, title, start, end) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, 'END:VEVENT'].join('\r\n');
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  vevent('1@t', 'Reunião passada', past, new Date(past.getTime() + 3600_000)),
  vevent('2@t', 'Consulta de teste', soon, new Date(soon.getTime() + 1800_000)),
  vevent('3@t', 'Almoço com a equipe', later, new Date(later.getTime() + 3600_000)),
  ['BEGIN:VEVENT', 'UID:4@t', 'SUMMARY:Dia de folga', `DTSTART;VALUE=DATE:${dateOnly(todayStart)}`, `DTEND;VALUE=DATE:${dateOnly(new Date(todayStart.getTime() + 30 * 3600_000))}`, 'END:VEVENT'].join('\r\n'),
  vevent('5@t', 'Amanhã não aparece hoje', tomorrow, new Date(tomorrow.getTime() + 3600_000)),
  'END:VCALENDAR',
].join('\r\n');
const icsFile = path.join(userData, 'fixture.ics');
fs.writeFileSync(icsFile, ics);

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

let app;
const launch = () =>
  spawn(electronPath, [root, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], {
    stdio: 'ignore',
    env: { ...process.env, MOCHI_E2E_CALENDAR_FILE: icsFile },
  });

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
  const ev = (expression) =>
    new Promise((resolve, reject) => {
      const my = ++id;
      pending.set(my, (d) => {
        if (d.result?.exceptionDetails) reject(new Error(`erro no navegador: ${d.result.exceptionDetails.text}`));
        else resolve(d.result?.result?.value);
      });
      ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  const waitFor = async (expression, label, timeoutMs = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  // Com MOCHI_SHOTS=<pasta>, grava uma captura (inspeção visual).
  const shot = (file) =>
    new Promise((resolve) => {
      const my = ++id;
      pending.set(my, (d) => {
        if (d.result?.data && process.env.MOCHI_SHOTS) {
          fs.mkdirSync(process.env.MOCHI_SHOTS, { recursive: true });
          fs.writeFileSync(path.join(process.env.MOCHI_SHOTS, file), Buffer.from(d.result.data, 'base64'));
        }
        resolve();
      });
      ws.send(JSON.stringify({ id: my, method: 'Page.captureScreenshot', params: { format: 'png' } }));
    });
  return { ev, waitFor, shot, close: () => ws.close() };
}

let page;
let panel;
try {
  console.log('Agenda (iCal) — app real, sem rede, dados isolados');
  app = launch();
  page = await connect(await findTarget('mascot'));
  await page.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');

  await step('sem agenda: nada configurado e o cofre está disponível', async () => {
    const s = await page.ev(`window.mochi.calendar.get()`);
    assert.equal(s.configured, false);
    assert.equal(s.canStore, true);
    assert.deepEqual(s.events, []);
  });

  await step('endereços inválidos são recusados com mensagem (nada é guardado)', async () => {
    for (const bad of ['', 'amanhã', 'http://calendar.google.com/x.ics', 'https://127.0.0.1/x.ics', 'https://u:p@calendar.google.com/x.ics']) {
      const r = await page.ev(`window.mochi.calendar.setUrl(${JSON.stringify(bad)})`);
      assert.equal(r.ok, false, bad);
      assert.ok(r.message.length > 0);
    }
    assert.equal(fs.existsSync(path.join(userData, 'calendar-url.bin')), false);
  });

  await step('conectar: eventos de hoje chegam (o de amanhã, não) e o endereço NÃO volta para a interface', async () => {
    const r = await page.ev(`window.mochi.calendar.setUrl(${JSON.stringify(SECRET_URL)})`);
    assert.equal(r.ok, true);
    const titles = r.value.events.map((e) => e.title);
    assert.ok(titles.includes('Consulta de teste') && titles.includes('Almoço com a equipe'));
    assert.equal(r.value.host, 'calendar.google.com');
    const dump = JSON.stringify(r.value) + JSON.stringify(await page.ev(`window.mochi.calendar.get()`));
    assert.ok(!dump.includes('segredo9876'), 'o segredo vazou para a interface');
  });

  await step('o endereço é guardado criptografado em disco (não aparece em texto puro)', async () => {
    const bin = fs.readFileSync(path.join(userData, 'calendar-url.bin'));
    assert.ok(bin.length > 20);
    assert.ok(!bin.toString('latin1').includes('segredo9876'));
    for (const f of fs.readdirSync(userData)) {
      if (f === 'fixture.ics' || f === 'calendar-url.bin') continue;
      const p = path.join(userData, f);
      let text = null;
      try {
        if (fs.statSync(p).isFile()) text = fs.readFileSync(p, 'latin1');
      } catch {
        continue; // arquivos temporários do Chromium somem enquanto listamos
      }
      if (text !== null) assert.ok(!text.includes('segredo9876'), `vazou em ${f}`);
    }
  });

  await step('painel: "Agenda de hoje" lista os eventos na ordem certa e esmaece o que já passou', async () => {
    await page.ev(`window.mochi.openSettings()`);
    panel = await connect(await findTarget('panel'));
    await panel.waitFor(`!!document.querySelector('.settings')`, 'configurações');
    await panel.ev(`document.querySelector('.settings-back').click()`);
    await panel.waitFor(`!!document.querySelector('.agenda')`, 'agenda');
    await panel.waitFor(`document.querySelectorAll('.agenda-item').length >= 3`, 'itens');
    const items = await panel.ev(
      `[...document.querySelectorAll('.agenda-item')].map((li) => ({ t: li.querySelector('.agenda-title').textContent, past: li.dataset.past }))`,
    );
    assert.equal(items[0].t, 'Dia de folga', 'dia inteiro primeiro');
    const idxPast = items.findIndex((i) => i.t === 'Reunião passada');
    assert.ok(idxPast > items.findIndex((i) => i.t === 'Almoço com a equipe'), 'o que passou vai por último');
    assert.equal(items[idxPast].past, 'true');
    assert.ok(!items.some((i) => i.t.startsWith('Amanhã')));
  });

  await step('lembrete: na hora do evento o Mochi mostra o balão com o nome dele', async () => {
    const seen = new Set();
    const t0 = Date.now();
    let found = false;
    while (Date.now() - t0 < 100000 && !found) {
      const text = await page.ev(`document.querySelector('.speech')?.textContent ?? ''`);
      if (text) seen.add(text);
      found = text.includes('Chegou a hora: Consulta de teste');
      if (!found) await sleep(250);
    }
    assert.ok(found, `balões vistos: ${JSON.stringify([...seen])}; ${Math.round((Date.now() - t0) / 1000)} s`);
  });
  await step('"Virar tarefa": só aparece em eventos que ainda não terminaram', async () => {
    const rows = await panel.ev(
      `[...document.querySelectorAll('.agenda-item')].map((li) => ({ t: li.querySelector('.agenda-title').textContent, btn: !!li.querySelector('.agenda-make-task'), label: li.querySelector('.agenda-make-task')?.textContent.trim() ?? null }))`,
    );
    const by = (title) => rows.find((r) => r.t === title);
    assert.equal(by('Reunião passada').btn, false, 'o que já terminou não vira tarefa');
    assert.equal(by('Almoço com a equipe').btn, true);
    assert.equal(by('Dia de folga').btn, true, 'dia inteiro também pode');
    assert.equal(by('Almoço com a equipe').label, 'Virar tarefa');
  });

  await step('clicar vira tarefa: título do evento, horário como prazo (dia inteiro sem prazo), e o botão vira "✓ Tarefa"', async () => {
    const events = (await page.ev(`window.mochi.calendar.get()`)).events;
    const lunch = events.find((e) => e.title === 'Almoço com a equipe');
    const click = (title) =>
      panel.ev(
        `[...document.querySelectorAll('.agenda-item')].find((li) => li.querySelector('.agenda-title').textContent === ${JSON.stringify(title)}).querySelector('.agenda-make-task').click()`,
      );
    await click('Almoço com a equipe');
    await panel.waitFor(
      `[...document.querySelectorAll('.agenda-item')].find((li) => li.querySelector('.agenda-title').textContent === 'Almoço com a equipe')?.querySelector('.agenda-linked')?.textContent.includes('Tarefa')`,
      'marcado como tarefa',
    );
    await click('Dia de folga');
    await panel.waitFor(`document.querySelectorAll('.agenda-linked').length === 2`, 'segunda tarefa');
    const list = await panel.ev(`window.mochi.tasks.list()`);
    assert.equal(list.ok, true);
    const mine = list.value.active.filter((t) => t.sourceRef);
    assert.equal(mine.length, 2);
    const lunchTask = mine.find((t) => t.title === 'Almoço com a equipe');
    assert.equal(lunchTask.dueAt, new Date(lunch.start).toISOString());
    assert.equal(lunchTask.sourceRef, lunch.id);
    assert.equal(mine.find((t) => t.title === 'Dia de folga').dueAt, null);
    await panel.shot('agenda-virar-tarefa.png');
  });

  await step('não duplica: criar de novo com a mesma origem devolve a mesma tarefa', async () => {
    const events = (await page.ev(`window.mochi.calendar.get()`)).events;
    const lunch = events.find((e) => e.title === 'Almoço com a equipe');
    const before = await panel.ev(`window.mochi.tasks.list().then((l) => l.value.active.length)`);
    const again = await panel.ev(
      `window.mochi.tasks.create('Almoço com a equipe', null, ${JSON.stringify(lunch.id)})`,
    );
    assert.equal(again.ok, true);
    const after = await panel.ev(`window.mochi.tasks.list().then((l) => l.value.active.length)`);
    assert.equal(after, before);
    const bad = await panel.ev(`window.mochi.tasks.create('x', null, 'com\\nquebra')`);
    assert.equal(bad.ok, false);
  });

  await step('excluir a tarefa devolve o botão; desfazer marca de novo', async () => {
    const list = await panel.ev(`window.mochi.tasks.list()`);
    const lunchTask = list.value.active.find((t) => t.title === 'Almoço com a equipe');
    await panel.ev(`window.mochi.tasks.scheduleRemove(${JSON.stringify(lunchTask.id)})`);
    await panel.waitFor(
      `!!([...document.querySelectorAll('.agenda-item')].find((li) => li.querySelector('.agenda-title').textContent === 'Almoço com a equipe')?.querySelector('.agenda-make-task'))`,
      'botão de volta',
    );
    await panel.ev(`window.mochi.tasks.undoRemove(${JSON.stringify(lunchTask.id)})`);
    await panel.waitFor(
      `!!([...document.querySelectorAll('.agenda-item')].find((li) => li.querySelector('.agenda-title').textContent === 'Almoço com a equipe')?.querySelector('.agenda-linked'))`,
      'marcado de novo',
    );
  });

  await step('"Pauta": cria UMA nota ligada ao evento e abre a janela de notas; de novo, a mesma', async () => {
    const events = (await page.ev(`window.mochi.calendar.get()`)).events;
    const lunch = events.find((e) => e.title === 'Almoço com a equipe');
    const click = () =>
      panel.ev(
        `[...document.querySelectorAll('.agenda-item')].find((li) => li.querySelector('.agenda-title').textContent === 'Almoço com a equipe').querySelector('.agenda-agenda-note').click()`,
      );
    await click();
    const manager = await connect(await findTarget('notes='));
    await manager.waitFor(`document.querySelector('.notes-link-badge')?.textContent === 'Pauta de um evento da agenda'`, 'nota da pauta');
    manager.close();
    await sleep(300);
    await click();
    await sleep(700);
    const list = await page.ev(`window.mochi.notes.list()`);
    const mine = list.value.filter((n) => n.eventRef === lunch.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].title, 'Almoço com a equipe');
    await panel.waitFor(
      `[...document.querySelectorAll('.agenda-item')].find((li) => li.querySelector('.agenda-title').textContent === 'Almoço com a equipe').querySelector('.agenda-agenda-note').dataset.has === 'true'`,
      'botão marcado',
    );
  });
  await step('reabrir o app: a agenda volta sozinha (endereço lido do cofre) mesmo sem baixar de novo', async () => {
    page.close();
    panel?.close();
    app.kill();
    await sleep(1500);
    app = launch();
    page = await connect(await findTarget('mascot'));
    await page.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
    await page.waitFor(`window.mochi.calendar.get().then((s) => s.configured && s.events.length >= 3)`, 'agenda restaurada');
  });

  await step('remover: apaga endereço e cópia, e a seção some', async () => {
    const s = await page.ev(`window.mochi.calendar.clear()`);
    assert.equal(s.configured, false);
    assert.equal(s.events.length, 0);
    assert.equal(fs.existsSync(path.join(userData, 'calendar-url.bin')), false);
    assert.equal(fs.existsSync(path.join(userData, 'calendar-cache.json')), false);
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
  app?.kill();
  await sleep(600);
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* arquivos ainda em uso */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);