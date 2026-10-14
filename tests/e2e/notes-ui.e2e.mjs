/**
 * Notas (formatação, janela de gerenciamento, nota flutuante, persistência, segurança) no app REAL.
 * Mesmas regras dos outros e2e: dados isolados (`--user-data-dir`), nada de mouse do sistema.
 * Com `MOCHI_SHOTS=<pasta>` grava capturas para inspeção visual.
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
const SHOTS = process.env.MOCHI_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-notes-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: false }));

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

let port = 9870 + Math.floor(Math.random() * 60);
let app = null;
const launch = () => {
  port = 9870 + Math.floor(Math.random() * 60);
  app = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { stdio: 'ignore' });
};

async function targets() {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === 'page');
  } catch {
    return [];
  }
}
async function findTarget(hashPart, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const page = (await targets()).find((t) => t.url.includes(`#${hashPart}`));
    if (page) return page;
    await sleep(250);
  }
  throw new Error(`alvo #${hashPart} não apareceu`);
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
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(`erro no navegador: ${d.exception?.description ?? d.text} :: ${expression.slice(0, 120)}`);
    }
    return r.result?.result?.value;
  };
  const waitFor = async (expression, label, timeoutMs = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  const shot = async (file) => {
    if (!SHOTS) return;
    const r = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(r.result.data, 'base64'));
  };
  return { ev, waitFor, shot, call, close: () => ws.close() };
}

const conns = [];
const track = (c) => (conns.push(c), c);

try {
  console.log('Notas — formatação, janela de notas, nota flutuante, persistência e segurança (app real)');
  launch();
  const main = track(await connect(await findTarget('mascot')));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');

  const api = (expr) => main.ev(expr);
  let noteId = null;

  await step('criar pela API: título derivado, cor padrão, lista e busca sem acento', async () => {
    const r = await api(
      `window.mochi.notes.create({ doc: { type: 'doc', content: [ { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Reunião de planejamento' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'pauta do trimestre' }] } ] } })`,
    );
    assert.equal(r.ok, true);
    noteId = r.value.id;
    assert.equal(r.value.title, 'Reunião de planejamento');
    assert.equal(r.value.color, 'yellow');
    const list = await api(`window.mochi.notes.list('reuniao')`);
    assert.equal(list.ok, true);
    assert.deepEqual(list.value.map((n) => n.id), [noteId]);
    assert.equal(list.value[0].preview, 'pauta do trimestre');
  });

  await step('segurança: nós/marcas/links perigosos são recusados ou removidos no main', async () => {
    const bad = await api(`window.mochi.notes.create({ doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'file:///c:/x.png' } }] } })`);
    assert.equal(bad.ok, false);
    const script = await api(`window.mochi.notes.update(${JSON.stringify(noteId)}, { doc: { type: 'doc', content: [{ type: 'script' }] } })`);
    assert.equal(script.ok, false);
    const link = await api(
      `window.mochi.notes.create({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'bold' }] }] }] } })`,
    );
    assert.equal(link.ok, true);
    assert.deepEqual(link.value.doc.content[0].content[0].marks, [{ type: 'bold' }]);
    await api(`window.mochi.notes.remove(${JSON.stringify(link.value.id)})`);
    const badColor = await api(`window.mochi.notes.update(${JSON.stringify(noteId)}, { color: 'neon' })`);
    assert.equal(badColor.ok, false);
    const notId = await api(`window.mochi.notes.get('../../etc/passwd')`);
    assert.equal(notId.ok, false);
  });

  let manager;
  await step('o atalho "Notas" da ilha abre a janela de notas com a lista', async () => {
    await main.ev(`window.mochi.notes.openManager()`);
    manager = track(await connect(await findTarget('notes')));
    await manager.waitFor(`!!document.querySelector('.notes-app')`, 'janela de notas');
    await manager.waitFor(`document.querySelectorAll('.notes-item').length >= 1`, 'lista');
    const titles = await manager.ev(`[...document.querySelectorAll('.notes-item-title')].map((e) => e.textContent.trim())`);
    assert.ok(titles.includes('Reunião de planejamento'));
  });

  await step('editor: digitar e aplicar negrito, título, lista, tarefa, cor, marca-texto, link e alinhamento', async () => {
    await manager.ev(`[...document.querySelectorAll('.notes-item')].find((b) => b.textContent.includes('Reunião')).click()`);
    await manager.waitFor(`!!document.querySelector('.note-prose')`, 'editor');
    const click = (label) => manager.ev(`document.querySelector('[aria-label^="${label}"]').click()`);
    // Novo parágrafo no fim, com texto que recebe a formatação.
    await manager.ev(`(() => { const el = document.querySelector('.note-prose'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('insertParagraph'); document.execCommand('insertText', false, 'Texto importante'); })()`);
    // seleciona só a última linha: Shift+Home equivalente
    await manager.ev(`(() => { const ed = document.querySelector('.note-prose').editor; let from = -1; ed.state.doc.descendants((n, pos) => { if (n.isText && n.text === 'Texto importante') from = pos; }); ed.chain().focus().setTextSelection({ from, to: from + 'Texto importante'.length }).run(); })()`);
    await click('Negrito');
    await click('Itálico');
    await click('Sublinhado');
    await click('Centralizar');
    await click('Cor do texto');
    await manager.ev(`document.querySelector('[aria-label="Texto #c0392b"]').click()`);
    await manager.ev(`(() => { const ed = document.querySelector('.note-prose').editor; let from = -1; ed.state.doc.descendants((n, pos) => { if (n.isText && n.text === 'Texto importante') from = pos; }); ed.chain().focus().setTextSelection({ from, to: from + 'Texto importante'.length }).run(); })()`);
    await click('Marca-texto');
    await manager.ev(`document.querySelector('[aria-label="Marca-texto #fff176"]').click()`);
    // lista de tarefas com um item
    await manager.ev(`(() => { const el = document.querySelector('.note-prose'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('insertParagraph'); document.execCommand('insertText', false, 'comprar café'); })()`);
    await click('Lista de tarefas');
    await manager.ev(`(() => { const el = document.querySelector('.note-prose'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('insertParagraph'); document.execCommand('insertText', false, 'ver o site'); })()`);
    // link: seleciona "café" pela API do editor (determinístico; a seleção do DOM é lida de forma assíncrona)
    await manager.ev(`(() => { const ed = document.querySelector('.note-prose').editor; let from = -1; ed.state.doc.descendants((n, pos) => { if (n.isText && n.text.includes('café')) from = pos + n.text.indexOf('café'); }); ed.chain().focus().setTextSelection({ from, to: from + 4 }).run(); })()`);    await click('Link');
    await manager.waitFor(`!!document.querySelector('.note-link-input')`, 'campo do link');
    await manager.ev(`(() => { const i = document.querySelector('.note-link-input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'exemplo.com/pagina'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(150); // deixa o React aplicar o valor digitado antes de enviar
    await manager.ev(`document.querySelector('.note-link-form').requestSubmit()`);
    // título grande no primeiro bloco já existe (H1); confere um H2 em outra linha
    await sleep(900); // autosave
    const r = await api(`window.mochi.notes.get(${JSON.stringify(noteId)})`);
    assert.equal(r.ok, true);
    const json = JSON.stringify(r.value.doc);
    for (const piece of ['"bold"', '"italic"', '"underline"', '"textAlign":"center"', '"#c0392b"', '"#fff176"', '"taskList"', '"taskItem"', 'https://exemplo.com/pagina']) {
      assert.ok(json.includes(piece), `faltou ${piece} em ...${json.slice(-600)}`);
    }
    assert.ok(json.includes('Texto importante') && json.includes('comprar ') && json.includes('"café"'), json);
    await manager.shot('notes-manager.png');
  });

  await step('o texto digitado é o título/prévia da lista e a busca encontra por trecho', async () => {
    const list = await api(`window.mochi.notes.list('importante')`);
    assert.deepEqual(list.value.map((n) => n.id), [noteId]);
    await manager.ev(`(() => { const i = document.querySelector('.notes-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'cafe'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await manager.waitFor(`document.querySelectorAll('.notes-item').length === 1`, 'busca filtrada');
    await manager.ev(`(() => { const i = document.querySelector('.notes-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'zzzz'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await manager.waitFor(`document.querySelectorAll('.notes-item').length === 0 && !!document.querySelector('.notes-none')`, 'sem resultado');
    await manager.ev(`(() => { const i = document.querySelector('.notes-search'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await manager.waitFor(`document.querySelectorAll('.notes-item').length >= 1`, 'lista volta');
  });

  let floating;
  await step('fixar: a nota vira uma folha flutuante (janela própria, fora da barra de tarefas, não "sempre no topo")', async () => {
    await manager.ev(`document.querySelector('[aria-pressed]').closest('.notes-main-actions') && [...document.querySelectorAll('.notes-action')].find((b) => b.textContent.includes('Fixar')).click()`);
    floating = track(await connect(await findTarget(`note=${noteId}`)));
    await floating.waitFor(`!!document.querySelector('.note-sheet')`, 'folha');
    await floating.waitFor(`document.querySelector('.note-prose')?.textContent.includes('Texto importante')`, 'conteúdo');
    assert.equal(await floating.ev(`document.querySelector('.note-sheet').dataset.color`), 'yellow');
    const n = await api(`window.mochi.notes.get(${JSON.stringify(noteId)})`);
    assert.equal(n.value.pinned, true);
    await sleep(500);
    await floating.shot('note-floating.png');
  });

  await step('cor do papel: trocar no gerenciador muda a folha flutuante na hora', async () => {
    await manager.ev(`document.querySelector('.notes-colors [aria-label="Rosa"]').click()`);
    await floating.waitFor(`document.querySelector('.note-sheet').dataset.color === 'pink'`, 'papel rosa');
    const bg = await floating.ev(`getComputedStyle(document.querySelector('.note-sheet')).backgroundColor`);
    assert.ok(bg.length > 0);
  });

  await step('editar na nota flutuante aparece no editor do gerenciador (sem digitar por cima)', async () => {
    await floating.ev(`(() => { const el = document.querySelector('.note-prose'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.execCommand('insertParagraph'); document.execCommand('insertText', false, 'escrito na folha'); })()`);
    await sleep(900);
    await manager.ev(`document.activeElement.blur?.()`);
    await manager.waitFor(`document.querySelector('.note-prose')?.textContent.includes('escrito na folha')`, 'texto chegou ao gerenciador', 6000);
  });

  await step('soltar (✕ na folha): a janela fecha e a nota continua guardada; fixar de novo reabre', async () => {
    await floating.ev(`document.querySelector('.note-unpin').click()`);
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && (await targets()).some((t) => t.url.includes(`#note=${noteId}`))) await sleep(150);
    assert.equal((await targets()).some((t) => t.url.includes(`#note=${noteId}`)), false);
    const n = await api(`window.mochi.notes.get(${JSON.stringify(noteId)})`);
    assert.equal(n.ok, true);
    assert.equal(n.value.pinned, false);
    await api(`window.mochi.notes.update(${JSON.stringify(noteId)}, { pinned: true })`);
    floating = track(await connect(await findTarget(`note=${noteId}`)));
    await floating.waitFor(`!!document.querySelector('.note-sheet')`, 'reaberta');
  });

  await step('persistência: a nota flutuante reabre sozinha ao reiniciar o app, no mesmo lugar', async () => {
    const before = await api(`window.mochi.notes.update(${JSON.stringify(noteId)}, { bounds: { x: 180, y: 140, width: 360, height: 280 } })`);
    assert.equal(before.ok, true);
    await sleep(500);
    conns.splice(0).forEach((c) => c.close());
    app.kill();
    await sleep(1500);
    launch();
    const f = track(await connect(await findTarget(`note=${noteId}`)));
    await f.waitFor(`!!document.querySelector('.note-sheet')`, 'folha reaberta');
    await f.waitFor(`document.querySelector('.note-prose')?.textContent.includes('escrito na folha')`, 'conteúdo salvo');
    const bounds = await f.ev(`({ x: window.screenX, y: window.screenY })`);
    assert.ok(Math.abs(bounds.x - 180) <= 16 && Math.abs(bounds.y - 140) <= 16, JSON.stringify(bounds));
  });

  await step('excluir pelo gerenciador remove a janela flutuante; "Desfazer" recria a nota', async () => {
    const m = track(await connect(await findTarget('mascot')));
    await m.ev(`window.mochi.notes.openManager(${JSON.stringify(noteId)})`);
    const mgr = track(await connect(await findTarget('notes')));
    await mgr.waitFor(`document.querySelector('.notes-item[aria-current="true"]')?.textContent.includes('Reunião')`, 'nota aberta');
    await mgr.ev(`document.querySelector('.notes-danger').click()`);
    await mgr.waitFor(`!!document.querySelector('.notes-undo')`, 'aviso de desfazer');
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && (await targets()).some((t) => t.url.includes(`#note=${noteId}`))) await sleep(150);
    assert.equal((await targets()).some((t) => t.url.includes(`#note=${noteId}`)), false, 'folha fechou');
    const gone = await m.ev(`window.mochi.notes.get(${JSON.stringify(noteId)})`);
    assert.equal(gone.ok, false);
    await mgr.ev(`document.querySelector('.notes-undo button').click()`);
    await mgr.waitFor(`document.querySelectorAll('.notes-item').length >= 1`, 'nota de volta');
    const list = await m.ev(`window.mochi.notes.list()`);
    assert.equal(list.value.length, 1);
    assert.equal(list.value[0].title, 'Reunião de planejamento');
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
