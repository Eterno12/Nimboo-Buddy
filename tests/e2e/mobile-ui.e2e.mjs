/**
 * App móvel (versão web empacotada em dist-mobile) no Chromium real, com o banco sql.js persistido em
 * IndexedDB e um Supabase falso na rede local: criar/concluir tarefas, sobreviver a recarregar a página,
 * entrar por código, sincronizar com "outro aparelho" e voltar ao estado depois de recarregar.
 * Precisa de `npm run build:mobile` antes.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startFakeSupabase } from './fakeSupabase.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = createRequire(import.meta.url)('electron');
const distDir = path.join(root, 'dist-mobile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.log('dist-mobile não existe: rode `npm run build:mobile`');
  process.exit(1);
}

// Servidor estático do app (com o tipo certo para .wasm).
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const staticServer = http.createServer((req, res) => {
  const file = path.join(distDir, decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+$/, 'index.html'));
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(distDir, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});
await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${staticServer.address().port}`;
const fake = await startFakeSupabase();

const results = [];
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

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-mobile-'));
const port = 9300 + Math.floor(Math.random() * 90);
const proc = spawn(
  electronPath,
  [path.join(root, 'tests', 'e2e', 'browser-host.cjs'), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, `${appUrl}/index.html?sync=${fake.url}`],
  { stdio: 'ignore' },
);

async function connect() {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page' && t.url.startsWith(appUrl));
    } catch {
      /* subindo */
    }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error('página não abriu');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) (pending.get(d.id)(d), pending.delete(d.id));
  };
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const my = ++id;
      pending.set(my, resolve);
      ws.send(JSON.stringify({ id: my, method, params }));
    });
  const ev = async (expression) => {
    const d = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (d.result?.exceptionDetails) throw new Error(`erro no navegador: ${d.result.exceptionDetails.exception?.description ?? d.result.exceptionDetails.text}`);
    return d.result?.result?.value;
  };
  const waitFor = async (expression, label, ms = 12000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(100)) if (await ev(expression).catch(() => false)) return;
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  return { ev, waitFor, call, close: () => ws.close() };
}

const setValue = (p, testid, value) =>
  p.ev(`(() => { const i = document.querySelector('[data-testid="${testid}"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const click = (p, testid) => p.ev(`document.querySelector('[data-testid="${testid}"]').click()`);
const taskTitles = (p) => p.ev(`[...document.querySelectorAll('[data-testid="task"] .task-title')].map((e) => e.textContent).sort()`);

let page;
try {
  console.log('App móvel (web) — telas, banco persistido, login e sincronização (Chromium real, servidor falso)');
  page = await connect();
  await page.waitFor(`!!document.querySelector('[data-testid="screen-today"]')`, 'tela Hoje');

  const addTask = async (title, extra = '') => {
    await click(page, 'tab-tasks');
    await page.waitFor(`!!document.querySelector('[data-testid="fab-add"]')`, 'botão de nova tarefa');
    await click(page, 'fab-add');
    await page.waitFor(`!!document.querySelector('[data-testid="field-title"]')`, 'folha de nova tarefa');
    await setValue(page, 'field-title', title);
    if (extra) await page.ev(extra);
    await click(page, 'save-task');
    await page.waitFor(`!document.querySelector('[data-testid="field-title"]')`, 'folha fechou');
    await page.waitFor(`[...document.querySelectorAll('[data-testid="task"] .task-title')].some((e) => e.textContent === ${JSON.stringify(title)})`, `tarefa ${title}`);
  };

  await step('Hoje: sem tarefas mostra "Tudo em dia!" e o mascote', async () => {
    assert.equal(await page.ev(`document.querySelector('[data-testid="today-line"]').textContent`), 'Tudo em dia!');
    assert.equal(await page.ev(`!!document.querySelector('[data-testid="screen-today"] svg.mascot')`), true);
  });

  await step('criar tarefas (com prazo e prioridade) e vê-las na lista', async () => {
    await addTask('Comprar pão');
    await addTask('Estudar');
    assert.deepEqual(await taskTitles(page), ['Comprar pão', 'Estudar']);
  });

  await step('editar: título, subtarefa e prioridade pela folha', async () => {
    await page.ev(`[...document.querySelectorAll('[data-testid="task"] .task-main')].find((b) => b.textContent.includes('Estudar')).click()`);
    await page.waitFor(`!!document.querySelector('[data-testid="field-title"]')`, 'folha de edição');
    await setValue(page, 'field-title', 'Estudar capítulo 4');
    await page.ev(`document.querySelector('.segmented [data-priority="3"]').click()`);
    await setValue(page, 'field-sub', 'Resumo');
    await page.ev(`document.querySelector('.inline-add .btn-soft').click()`);
    await page.waitFor(`document.querySelectorAll('.subtasks li').length === 1`, 'subtarefa criada');
    await click(page, 'save-edit');
    await page.waitFor(`!document.querySelector('[data-testid="field-title"]')`, 'folha fechou');
    await page.waitFor(`[...document.querySelectorAll('[data-testid="task"] .task-title')].some((e) => e.textContent === 'Estudar capítulo 4')`, 'título novo');
    const meta = await page.ev(`[...document.querySelectorAll('[data-testid="task"]')].find((r) => r.textContent.includes('Estudar capítulo 4')).textContent`);
    assert.match(meta, /Alta/, 'prioridade alta aparece');
    assert.match(meta, /0\/1/, 'contador de subtarefas');
  });

  await step('excluir mostra "Desfazer"; desfazer devolve a tarefa; sem desfazer ela some de verdade', async () => {
    await page.ev(`[...document.querySelectorAll('[data-testid="task"] .task-main')].find((b) => b.textContent.includes('Comprar pão')).click()`);
    await click(page, 'delete-task');
    await page.waitFor(`!!document.querySelector('[data-testid="snackbar"]')`, 'aviso de exclusão');
    assert.deepEqual(await taskTitles(page), ['Estudar capítulo 4']);
    await click(page, 'undo');
    await page.waitFor(`document.querySelectorAll('[data-testid="task"]').length === 2`, 'tarefa voltou');

    await page.ev(`[...document.querySelectorAll('[data-testid="task"] .task-main')].find((b) => b.textContent.includes('Comprar pão')).click()`);
    await click(page, 'delete-task');
    await page.waitFor(`!document.querySelector('[data-testid="snackbar"]')`, 'prazo do desfazer acabou', 9000);
    const rows = await page.ev(`window.__nimboo.tasks.list().then((l) => l.active.map((t) => t.title).sort())`);
    assert.deepEqual(rows, ['Estudar capítulo 4', 'Resumo']);
  });

  await step('Hoje reflete as tarefas e recarregar a página não perde nada (banco persistido)', async () => {
    await sleep(600);
    await page.call('Page.reload');
    await page.waitFor(`!!document.querySelector('[data-testid="screen-today"]')`, 'recarregou', 15000);
    await click(page, 'tab-tasks');
    await page.waitFor(`document.querySelectorAll('[data-testid="task"]').length === 1`, 'tarefa principal depois de recarregar', 15000);
    assert.deepEqual(await taskTitles(page), ['Estudar capítulo 4']);
  });

  await step('sem conta nada é enviado; entrar com código e ligar sincroniza nos dois sentidos', async () => {
    assert.equal(fake.state.pushes, 0);
    fake.seedTask('44444444-4444-4444-8444-444444444444', 'Veio do PC');
    await click(page, 'tab-profile');
    await setValue(page, 'email', 'ana@exemplo.com');
    await click(page, 'send-code');
    await page.waitFor(`!!document.querySelector('[data-testid="code"]')`, 'campo de código');
    await setValue(page, 'code', '000000');
    await click(page, 'enter');
    await page.waitFor(`/incorreto|expirado/.test(document.querySelector('[data-testid="msg"]')?.textContent ?? '')`, 'erro de código');
    await setValue(page, 'code', '123456');
    await click(page, 'enter');
    await page.waitFor(`!!document.querySelector('[data-testid="account"]')`, 'conta aberta');
    assert.equal(fake.state.pushes, 0, 'entrar não envia nada sem consentimento');

    await click(page, 'consent');
    await click(page, 'enable');
    await page.waitFor(`!!document.querySelector('[data-testid="sync-now"]')`, 'ligada');
    await click(page, 'sync-now');
    await sleep(900);
    const sent = [...fake.state.rows.values()].filter((r) => r.tbl === 'tasks' && !r.deleted).map((r) => r.payload.title).sort();
    assert.deepEqual(sent, ['Estudar capítulo 4', 'Resumo', 'Veio do PC']);
    await click(page, 'tab-tasks');
    await page.waitFor(`document.querySelectorAll('[data-testid="task"]').length === 2`, 'tarefa do PC apareceu');
    assert.deepEqual(await taskTitles(page), ['Estudar capítulo 4', 'Veio do PC']);
  });

  await step('concluir no celular chega ao servidor; sessão e cursor sobrevivem a recarregar', async () => {
    await page.ev(`[...document.querySelectorAll('[data-testid="task"]')].find((r) => r.textContent.includes('Veio do PC')).querySelector('.task-check').click()`);
    await page.waitFor(`document.querySelectorAll('[data-testid="task"]').length === 1`, 'saiu da lista de ativas');
    await click(page, 'tab-profile');
    await click(page, 'sync-now');
    await sleep(900);
    const done = [...fake.state.rows.values()].filter((r) => r.tbl === 'tasks' && !r.deleted && r.payload.completed === 1);
    assert.equal(done.length, 1);

    const pushesBefore = fake.state.pushes;
    await page.call('Page.reload');
    await page.waitFor(`!!document.querySelector('[data-testid="screen-today"]')`, 'recarregou', 15000);
    await click(page, 'tab-profile');
    await page.waitFor(`!!document.querySelector('[data-testid="account"]')`, 'sessão restaurada');
    await click(page, 'sync-now');
    await sleep(900);
    assert.equal(fake.state.pushes, pushesBefore, 'nada novo para enviar depois de recarregar');
  });

  await step('trocar o personagem no Perfil muda o mascote e fica salvo; sair mantém as tarefas', async () => {
    await click(page, 'char-cactus');
    await click(page, 'tab-today');
    await page.waitFor(`document.querySelector('[data-testid="screen-today"] svg.mascot')?.dataset.character === 'cactus'`, 'cacto na tela Hoje');
    await click(page, 'tab-profile');
    await click(page, 'sign-out');
    await page.waitFor(`!!document.querySelector('[data-testid="email"]')`, 'voltou ao login');
    await click(page, 'tab-tasks');
    assert.equal((await taskTitles(page)).length, 1);
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  page?.close();
  proc.kill();
  staticServer.close();
  await fake.close();
  await sleep(600);
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* o sistema limpa depois */
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);
