/**
 * Conta e sincronização no app REAL, com um "Supabase" falso em http://127.0.0.1 (MOCHI_E2E_SYNC_URL, só em
 * app não empacotado). Dois aparelhos (duas pastas de dados) trocam tarefas pela rede de verdade: login por
 * código, consentimento, envio, recebimento, edição, exclusão, apagar da nuvem e sair. Dados isolados.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const electronPath = createRequire(import.meta.url)('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Supabase falso (mesma regra de conflito do SQL) -------------------------------------------
const server = { rows: new Map(), seq: 0, codesSent: [], refreshes: 0, pushes: 0, validToken: new Set() };
const sessionFor = (email) => {
  const token = `tok-${Math.random().toString(36).slice(2)}`;
  server.validToken.add(token);
  return { access_token: token, refresh_token: `ref-${token}`, expires_in: 3600, user: { id: 'user-1', email } };
};
const httpServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const send = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };
  const authed = () => server.validToken.has((req.headers.authorization ?? '').replace('Bearer ', ''));
  const url = req.url ?? '';
  if (url === '/auth/v1/otp') {
    server.codesSent.push(body.email);
    return send(200, {});
  }
  if (url === '/auth/v1/verify') {
    if (body.token !== '123456') return send(403, { msg: 'Token has expired or is invalid' });
    return send(200, sessionFor(body.email));
  }
  if (url.startsWith('/auth/v1/token')) {
    server.refreshes++;
    return send(200, sessionFor('ana@exemplo.com'));
  }
  if (url === '/auth/v1/logout') return send(204);
  if (url.startsWith('/rest/v1/rpc/')) {
    if (!authed()) return send(401, { message: 'JWT expired' });
    const fn = url.split('/').pop();
    if (fn === 'sync_push') {
      server.pushes++;
      for (const r of body.batch) {
        const key = `${r.tbl}:${r.id}`;
        const cur = server.rows.get(key);
        const wins =
          !cur ||
          r.stamp > cur.stamp ||
          (r.stamp === cur.stamp && r.deleted && !cur.deleted) ||
          (r.stamp === cur.stamp && r.deleted === cur.deleted && r.origin > cur.origin);
        if (wins) server.rows.set(key, { ...r, payload: r.deleted ? null : r.payload, server_seq: ++server.seq });
      }
      return send(200, server.seq);
    }
    if (fn === 'sync_pull') {
      const rows = [...server.rows.values()].filter((r) => r.server_seq > body.since).sort((a, b) => a.server_seq - b.server_seq).slice(0, body.max_rows);
      return send(200, rows);
    }
    if (fn === 'sync_wipe') {
      server.rows.clear();
      return send(200, null);
    }
  }
  send(404, { message: 'não existe' });
});
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const SERVER_URL = `http://127.0.0.1:${httpServer.address().port}`;

// ---- Aparelhos ------------------------------------------------------------------------------
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
  const waitFor = async (expression, label, timeoutMs = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await ev(expression).catch(() => false)) return;
      await sleep(100);
    }
    throw new Error(`tempo esgotado esperando: ${label}`);
  };
  return { ev, waitFor, close: () => ws.close() };
}

const live = [];
async function launchDevice(name, portBase) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mochi-e2e-sync-${name}-`));
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ version: 3, hideDelaySec: 0, soundEnabled: false, bubbles: false, onboardingDone: true, routineMorning: false, routineEvening: false }),
  );
  const port = portBase + Math.floor(Math.random() * 40);
  const proc = spawn(electronPath, [root, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
    stdio: 'ignore',
    env: { ...process.env, MOCHI_E2E_SYNC_URL: SERVER_URL },
  });
  const findTarget = async (hash, timeoutMs = 25000) => {
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
  };
  const main = await connect(await findTarget('mascot'));
  await main.waitFor(`!!window.mochi && !!document.querySelector('.shell')`, 'app pronto');
  const device = { name, userData, proc, main, findTarget, panel: null };
  live.push(device);
  return device;
}

/** Abre Configurações > Geral no aparelho. */
async function openSyncPanel(d) {
  await d.main.ev(`window.mochi.openSettings()`);
  d.panel = await connect(await d.findTarget('panel'));
  await d.panel.waitFor(`!!document.querySelector('[data-testid="settings-tab-general"]')`, 'abas');
  await d.panel.ev(`document.querySelector('[data-testid="settings-tab-general"]').click()`);
  await d.panel.waitFor(`!!document.querySelector('[data-testid="sync-group"]') && !document.querySelector('[data-testid="sync-group"]').hidden`, 'grupo de sincronização');
}

const setValue = (c, testid, value) =>
  c.ev(`(() => { const i = document.querySelector('[data-testid="${testid}"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const click = (c, testid) => c.ev(`document.querySelector('[data-testid="${testid}"]').click()`);
/** Sincroniza agora, duas vezes: uma rodada já em andamento pode ter começado antes da última mudança. */
const syncTwice = async (d) => {
  await d.main.ev(`window.mochi.sync.now()`);
  await d.main.ev(`window.mochi.sync.now()`);
};
const titles = async (d) => (await d.main.ev(`window.mochi.tasks.list()`)).value.active.map((t) => t.title).sort();

try {
  console.log('Conta e sincronização — dois aparelhos, servidor falso na rede local (app real, dados isolados)');
  const A = await launchDevice('a', 9100);

  await step('sem conta: nada é enviado e a interface oferece entrar por e-mail', async () => {
    const s = await A.main.ev(`window.mochi.sync.get()`);
    assert.equal(s.account, null);
    assert.equal(s.enabled, false);
    assert.equal(s.status, 'off');
    await openSyncPanel(A);
    assert.equal(await A.panel.ev(`!!document.querySelector('[data-testid="sync-email"]')`), true);
    assert.equal(server.pushes, 0);
  });

  await step('entrar: código errado é recusado; o certo abre a conta (e o token nunca chega à interface)', async () => {
    await setValue(A.panel, 'sync-email', 'ana@exemplo.com');
    await click(A.panel, 'sync-send');
    await A.panel.waitFor(`!!document.querySelector('[data-testid="sync-code"]')`, 'campo do código');
    assert.deepEqual(server.codesSent, ['ana@exemplo.com']);

    await setValue(A.panel, 'sync-code', '000000');
    await click(A.panel, 'sync-enter');
    await A.panel.waitFor(`/incorreto|expirado/.test(document.querySelector('[data-testid="sync-message"]')?.textContent ?? '')`, 'mensagem de erro');

    await setValue(A.panel, 'sync-code', '123456');
    await click(A.panel, 'sync-enter');
    await A.panel.waitFor(`/ana@exemplo.com/.test(document.querySelector('[data-testid="sync-account"]')?.textContent ?? '')`, 'conta');
    const dump = JSON.stringify(await A.main.ev(`window.mochi.sync.get()`));
    assert.ok(!/tok-|ref-|access_token/.test(dump), 'token vazou');
    const sessionFile = fs.readFileSync(path.join(A.userData, 'sync-session.bin'));
    assert.ok(!sessionFile.toString('latin1').includes('tok-'), 'sessão estava em texto simples');
  });

  await step('ligar exige consentimento; depois disso as tarefas existentes sobem para a nuvem', async () => {
    await A.main.ev(`window.mochi.tasks.create('Tarefa do A')`);
    await A.main.ev(`window.mochi.tasks.create('Outra do A')`);
    assert.equal(await A.panel.ev(`document.querySelector('[data-testid="sync-enable"]').disabled`), true);
    assert.equal(server.pushes, 0, 'nada sobe antes de ligar');
    await click(A.panel, 'sync-consent');
    await click(A.panel, 'sync-enable');
    await A.panel.waitFor(`!!document.querySelector('[data-testid="sync-now"]')`, 'ligada');
    await click(A.panel, 'sync-now');
    await A.panel.waitFor(`/Sincronizado/.test(document.querySelector('[data-testid="sync-status"]')?.textContent ?? '')`, 'status sincronizado');
    const tasks = [...server.rows.values()].filter((r) => r.tbl === 'tasks' && !r.deleted).map((r) => r.payload.title).sort();
    assert.deepEqual(tasks, ['Outra do A', 'Tarefa do A']);
  });

  const B = await launchDevice('b', 9150);

  await step('segundo aparelho: entra com o mesmo e-mail e recebe as tarefas do primeiro', async () => {
    await openSyncPanel(B);
    await setValue(B.panel, 'sync-email', 'ana@exemplo.com');
    await click(B.panel, 'sync-send');
    await B.panel.waitFor(`!!document.querySelector('[data-testid="sync-code"]')`, 'código');
    await setValue(B.panel, 'sync-code', '123456');
    await click(B.panel, 'sync-enter');
    await B.panel.waitFor(`!!document.querySelector('[data-testid="sync-consent"]')`, 'conta B');
    await click(B.panel, 'sync-consent');
    await click(B.panel, 'sync-enable');
    await B.panel.waitFor(`!!document.querySelector('[data-testid="sync-now"]')`, 'ligada em B');
    await click(B.panel, 'sync-now');
    await B.panel.waitFor(`/Sincronizado/.test(document.querySelector('[data-testid="sync-status"]')?.textContent ?? '')`, 'sincronizado em B');
    assert.deepEqual(await titles(B), ['Outra do A', 'Tarefa do A']);
  });

  await step('editar num aparelho aparece no outro; concluir e excluir também', async () => {
    const list = (await B.main.ev(`window.mochi.tasks.list()`)).value.active;
    const target = list.find((t) => t.title === 'Tarefa do A');
    await sleep(15);
    await B.main.ev(`window.mochi.tasks.update(${JSON.stringify(target.id)}, { title: 'Editada no B' })`);
    await click(B.panel, 'sync-now');
    await B.panel.waitFor(`/Sincronizado/.test(document.querySelector('[data-testid="sync-status"]')?.textContent ?? '')`, 'B enviou');
    await click(A.panel, 'sync-now');
    await A.panel.waitFor(`/Sincronizado/.test(document.querySelector('[data-testid="sync-status"]')?.textContent ?? '')`, 'A recebeu');
    assert.deepEqual(await titles(A), ['Editada no B', 'Outra do A']);

    const other = (await A.main.ev(`window.mochi.tasks.list()`)).value.active.find((t) => t.title === 'Outra do A');
    await A.main.ev(`window.mochi.tasks.scheduleRemove(${JSON.stringify(other.id)})`);
    // A exclusão é finalizada depois do prazo do "Desfazer".
    await A.main.waitFor(`window.mochi.tasks.notice().then(() => true)`, 'ok');
    await sleep(5600);
    await syncTwice(A);
    await syncTwice(B);
    await B.main.waitFor(`window.mochi.tasks.list().then((r) => r.value.active.every((t) => t.title !== 'Outra do A'))`, 'exclusão chegou em B', 15000);
    assert.deepEqual(await titles(B), ['Editada no B']);
  });

  await step('personagem, acessório e conquistas seguem de um aparelho para o outro', async () => {
    // A troca o personagem; B recebe sozinho (sem devolver à nuvem).
    await A.main.ev(`window.mochi.settings.update({ character: 'cactus', mascotName: 'Espinho' })`);
    await sleep(400);
    await syncTwice(A);
    await syncTwice(B);
    await B.main.waitFor(`window.mochi.settings.get().then((r) => r.settings.character === 'cactus' && r.settings.mascotName === 'Espinho')`, 'B recebeu o personagem', 15000);

    // Concluir uma tarefa em A libera a conquista; B passa a ter a mesma conquista e os mesmos pontos.
    const t = await A.main.ev(`window.mochi.tasks.create('Para a conquista')`);
    await A.main.ev(`window.mochi.tasks.complete(${JSON.stringify(t.value.id)})`);
    await sleep(500);
    await syncTwice(A);
    await syncTwice(B);
    await B.main.waitFor(`window.mochi.bond.get().then((b) => b.achievements.find((a) => a.id === 'first_task')?.unlocked === true)`, 'conquista chegou em B', 15000);
    const pa = (await A.main.ev(`window.mochi.bond.get()`)).points;
    const pb = (await B.main.ev(`window.mochi.bond.get()`)).points;
    assert.ok(pa >= 10, `pontos em A: ${pa}`);
    assert.equal(pb >= 10, true, `pontos em B: ${pb}`);
  });

  await step('apagar da nuvem remove só a nuvem, desliga a sincronização e mantém os dados locais', async () => {
    await A.panel.ev(`document.querySelector('[data-testid="sync-wipe"]').closest('details').open = true`);
    await click(A.panel, 'sync-wipe');
    await click(A.panel, 'sync-wipe-confirm');
    await A.panel.waitFor(`/apagados da nuvem/.test(document.querySelector('[data-testid="sync-message"]')?.textContent ?? '')`, 'mensagem');
    assert.equal(server.rows.size, 0);
    assert.equal((await A.main.ev(`window.mochi.settings.get()`)).settings.syncEnabled, false);
    assert.deepEqual(await titles(A), ['Editada no B']);
  });

  await step('sair da conta mantém as tarefas locais e apaga a sessão', async () => {
    await A.panel.waitFor(`!!document.querySelector('[data-testid="sync-signout"]')`, 'botão sair');
    await click(A.panel, 'sync-signout');
    await A.panel.waitFor(`!!document.querySelector('[data-testid="sync-email"]')`, 'voltou ao login');
    assert.equal((await A.main.ev(`window.mochi.sync.get()`)).account, null);
    assert.equal(fs.existsSync(path.join(A.userData, 'sync-session.bin')), false);
    assert.deepEqual(await titles(A), ['Editada no B']);
  });
} catch (error) {
  console.log(`  FAIL (infra) ${error.message}`);
  results.push({ name: 'infraestrutura', ok: false, error });
} finally {
  for (const d of live) {
    try {
      d.main.close();
      d.panel?.close();
    } catch {
      /* já fechado */
    }
    d.proc.kill();
  }
  httpServer.close();
  await sleep(800);
  for (const d of live) {
    try {
      fs.rmSync(d.userData, { recursive: true, force: true });
    } catch {
      /* o sistema limpa depois */
    }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passos ok`);
process.exit(failed.length ? 1 : 0);
