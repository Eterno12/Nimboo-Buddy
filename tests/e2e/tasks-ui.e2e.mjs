/**
 * Teste de ponta a ponta da interface de tarefas, dirigindo o app REAL (Electron)
 * pelo protocolo de depuração (CDP). Não usa o mouse do sistema.
 *
 * - Usa um diretório de dados temporário (`--user-data-dir`): o banco real do app
 *   nunca é tocado.
 * - Exige o app compilado: rode `npm run build` antes (ou use `npm run test:e2e`).
 * - Precisa de uma sessão gráfica do Windows (abre as janelas do Mochi).
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = createRequire(import.meta.url)('electron');
const PORT = 9450 + Math.floor(Math.random() * 40);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-e2e-'));
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

// --- app -----------------------------------------------------------------------------
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
  const key = async (k, extra = {}) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, ...extra });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k });
  };
  const type = (text) => call('Input.insertText', { text });
  const move = (x, y) => call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  const waitFor = async (expression, label, timeoutMs = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression)) return;
      await sleep(80);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  return { ev, click, key, type, move, waitFor, close: () => ws.close() };
}

const db = () => new DatabaseSync(path.join(userData, 'data', 'mochi.db'), { readOnly: true });
const rows = () => {
  const d = db();
  try {
    return d.prepare('SELECT title, completed FROM tasks ORDER BY created_at').all().map((r) => ({ ...r }));
  } finally {
    d.close();
  }
};

let page;
try {
  console.log('Tarefas — interface (app real, dados isolados)');
  page = await connect(await findTarget('mascot'));
  await page.waitFor(`document.querySelector('.shell')?.dataset.mode === 'island'`, 'ilha visível');

  const center = (sel) =>
    page.ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  /** Atividade do usuário sobre a ilha (impede recolher/esconder por inatividade durante esperas do teste). */
  const keepAlive = () => page.move(176, 120);
  /** Tira o ponteiro da página: assim só a retenção por rascunho/foco pode manter a ilha aberta. */
  const pointerAway = async () => {
    await page.move(-30, -30);
    await sleep(120);
    assert.equal(await page.ev(`document.querySelector('.shell').matches(':hover')`), false, 'o ponteiro ainda está sobre a ilha');
  };
  const openTasks = async () => {
    if ((await page.ev(`document.querySelector('.shell').dataset.open`)) !== 'true') {
      await page.click(176, 28); // pílula compacta
      await page.waitFor(`document.querySelector('.shell').dataset.open === 'true'`, 'ilha aberta');
      // O recorte (clip-path) também recorta a área clicável: espera a abertura (320 ms) terminar.
      await sleep(450);
    }
    const [x, y] = await center('.island-shortcut');
    await page.click(x, y);
    await page.waitFor(`!!document.querySelector('.tasks-input')`, 'tela de tarefas');
  };

  await step('foco automático: ao abrir Tarefas o campo recebe o foco', async () => {
    await openTasks();
    await sleep(150);
    assert.equal(await page.ev(`document.activeElement?.classList.contains('tasks-input')`), true);
  });

  await step('título acima de 200 NÃO é truncado; contador e erro aparecem', async () => {
    await page.type('a'.repeat(250));
    await sleep(100);
    assert.equal(await page.ev(`document.querySelector('.tasks-input').value.length`), 250);
    assert.equal(await page.ev(`document.querySelector('.tasks-counter').textContent`), '250/200');
    assert.equal(await page.ev(`document.querySelector('.tasks-counter').dataset.over`), 'true');
    assert.match(await page.ev(`document.querySelector('.tasks-error').textContent`), /50 caracteres a mais/);
    assert.equal(await page.ev(`document.querySelector('.tasks-add').disabled`), true);
    assert.deepEqual(rows(), [], 'nada foi gravado');
  });

  await step('exatamente 200 caracteres é aceito', async () => {
    await page.key('a', { modifiers: 2, commands: ['selectAll'] });
    await page.key('Backspace');
    await page.type('b'.repeat(200));
    await sleep(100);
    assert.equal(await page.ev(`document.querySelector('.tasks-counter').textContent`), '200/200');
    assert.equal(await page.ev(`document.querySelector('.tasks-add').disabled`), false);
    await page.key('a', { modifiers: 2, commands: ['selectAll'] });
    await page.key('Backspace');
  });

  await step('rascunho: a ilha NÃO recolhe sozinha com texto não enviado (9,5 s)', async () => {
    await page.type('rascunho que ainda não enviei');
    await pointerAway(); // sem hover: só a retenção por foco/rascunho pode segurar a ilha
    await sleep(9500);
    assert.equal(await page.ev(`document.querySelector('.shell').dataset.open`), 'true');
  });

  await step('rascunho sobrevive a recolher (Esc) e reabrir; o foco volta ao campo', async () => {
    await page.key('Escape');
    await page.waitFor(`document.querySelector('.shell').dataset.open === 'false'`, 'ilha recolhida');
    await page.waitFor(`!document.querySelector('.tasks-input')`, 'tela desmontada');
    await openTasks();
    await sleep(150);
    assert.equal(await page.ev(`document.querySelector('.tasks-input').value`), 'rascunho que ainda não enviei');
    assert.equal(await page.ev(`document.activeElement?.classList.contains('tasks-input')`), true);
  });

  await step('Enter cria a tarefa, limpa o rascunho e anuncia (aria-live)', async () => {
    await page.key('Enter');
    await page.waitFor(`document.querySelectorAll('.tasks-scroll .task').length === 1`, 'tarefa na lista');
    assert.equal(await page.ev(`document.querySelector('.tasks-input').value`), '');
    assert.match(await page.ev(`document.querySelector('[role=status]').textContent`), /Tarefa adicionada: rascunho/);
    assert.deepEqual(rows(), [{ title: 'rascunho que ainda não enviei', completed: 0 }]);
  });

  await step('rodapé "Concluídas (n)" fica fora da área rolável, mesmo com muitas tarefas', async () => {
    await keepAlive();
    await page.ev(`(async()=>{ for (let i=1;i<=12;i++) await window.mochi.tasks.create('tarefa '+i) })()`);
    await page.waitFor(`document.querySelectorAll('.tasks-scroll .task').length === 13`, '13 tarefas');
    const info = await page.ev(`(()=>{
      const s=document.querySelector('.tasks-scroll'), f=document.querySelector('.tasks-footer'), isl=document.querySelector('.island');
      const fr=f.getBoundingClientRect(), ir=isl.getBoundingClientRect();
      return { overflow: s.scrollHeight > s.clientHeight, footerInside: !s.contains(f), footerVisible: fr.bottom <= ir.bottom + 1 && fr.top >= ir.top, label: f.querySelector('.tasks-disclosure').textContent.trim() }
    })()`);
    assert.equal(info.overflow, true, 'a lista rola');
    assert.equal(info.footerInside, true, 'o rodapé não está dentro da área rolável');
    assert.equal(info.footerVisible, true, 'o rodapé está visível');
    assert.equal(info.label, 'Concluídas (0)');
  });

  await step('barra de rolagem usa as cores do tema (não a nativa clara)', async () => {
    await keepAlive();
    const color = await page.ev(`getComputedStyle(document.querySelector('.tasks-scroll')).scrollbarColor`);
    assert.notEqual(color, 'auto');
    assert.match(color, /rgb/);
  });

  await step('concluir: some da lista, o Mochi comemora e a contagem sobe', async () => {
    await keepAlive();
    await page.ev(`document.querySelector('.tasks-scroll .task .task-primary').click()`);
    await page.waitFor(`document.querySelector('svg.mascot').dataset.state === 'celebrate'`, 'comemoração');
    await page.waitFor(`document.querySelector('.tasks-disclosure').textContent.includes('(1)')`, 'contagem');
    assert.equal(rows().filter((r) => r.completed === 1).length, 1);
  });

  await step('excluir mostra "Desfazer" e NÃO apaga do banco antes do prazo', async () => {
    await keepAlive();
    const before = rows().length;
    await page.ev(`document.querySelectorAll('.tasks-scroll .task')[0].querySelector('.task-remove').click()`);
    await page.waitFor(`!!document.querySelector('.tasks-undo')`, 'barra de desfazer');
    assert.equal(rows().length, before, 'a linha ainda está no SQLite');
    assert.match(await page.ev(`document.querySelector('[role=status]').textContent`), /Tarefa excluída/);
    assert.equal(
      await page.ev(`[...document.querySelectorAll('.tasks-scroll .task-title')].length`),
      before - 1 - 1, // menos a concluída e a escondida
    );
  });

  await step('Desfazer restaura a tarefa sem perda de dados', async () => {
    await keepAlive();
    const before = rows();
    await page.ev(`document.querySelector('.tasks-undo-button').click()`);
    await page.waitFor(`!document.querySelector('.tasks-undo')`, 'barra sumiu');
    await sleep(5600); // passou do prazo: nada pode ser apagado
    assert.deepEqual(rows(), before);
    assert.match(await page.ev(`document.querySelector('[role=status]').textContent`), /Exclusão desfeita/);
  });

  await step('sem desfazer, a exclusão vira definitiva só DEPOIS do prazo', async () => {
    await keepAlive();
    const before = rows().length;
    await page.ev(`document.querySelectorAll('.tasks-scroll .task')[0].querySelector('.task-remove').click()`);
    await page.waitFor(`!!document.querySelector('.tasks-undo')`, 'barra de desfazer');
    await sleep(2000);
    assert.equal(rows().length, before, 'aos 2 s ainda existe');
    await sleep(3800);
    assert.equal(rows().length, before - 1, 'após 5 s foi apagada');
    await page.waitFor(`!document.querySelector('.tasks-undo')`, 'barra sumiu');
  });

  await step('falha ao concluir aparece como erro (não finge sucesso)', async () => {
    await keepAlive();
    // Remove a linha por fora, sem avisar a interface: a lista fica desatualizada.
    const title = await page.ev(`document.querySelectorAll('.tasks-scroll .task-title')[0].textContent`);
    const writer = new DatabaseSync(path.join(userData, 'data', 'mochi.db'));
    writer.prepare('DELETE FROM tasks WHERE title = ?').run(title);
    writer.close();
    await page.ev(`document.querySelectorAll('.tasks-scroll .task')[0].querySelector('.task-primary').click()`);
    await page.waitFor(`!!document.querySelector('.tasks-error')`, 'mensagem de erro');
    const message = await page.ev(`[...document.querySelectorAll('.tasks-error')].map(e=>e.textContent).join(' | ')`);
    assert.match(message, /Não foi possível concluir/);
    assert.match(message, /não existe mais/);
    assert.equal(await page.ev(`document.querySelector('.tasks-error').getAttribute('role')`), 'alert');
  });
  await step('voltar: o foco retorna ao atalho "Tarefas"', async () => {
    await keepAlive();
    await page.ev(`document.querySelector('.tasks-header .tasks-icon-button').click()`);
    await page.waitFor(`document.querySelector('.shell').dataset.view === 'home'`, 'tela inicial');
    await sleep(150);
    assert.match(await page.ev(`document.activeElement?.textContent ?? ''`), /Tarefas/);
  });} catch (error) {
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
