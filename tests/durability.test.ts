import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { DatabaseSync as RawDatabase } from 'node:sqlite';
import { openDatabase, readPragma, SYNCHRONOUS_FULL } from '../electron/tasks/database.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import type { TaskChange } from '../shared/tasks.ts';

const DAY = 24 * 60 * 60 * 1000;

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-durability-'));
  return { file: path.join(dir, 'data', 'mochi.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function clock(start: string) {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

/** Registra todo SQL passado a `db.exec` (inclui BEGIN/COMMIT/ROLLBACK), com gancho opcional. */
function spyExec(db: DatabaseSync, before?: (sql: string) => void) {
  const original = db.exec.bind(db);
  const calls: string[] = [];
  mock.method(db, 'exec', (sql: string) => {
    calls.push(sql);
    before?.(sql);
    return original(sql);
  });
  return calls;
}
const writeTransactions = (calls: string[]) => calls.filter((c) => c === 'BEGIN IMMEDIATE').length;

/** Repositório + uma segunda conexão ao MESMO arquivo, com espera curta por bloqueios. */
function setup(start = '2026-01-01T00:00:00.000Z') {
  const tmp = tempFile();
  const c = clock(start);
  const events: TaskChange[] = [];
  const db = openDatabase(tmp.file, { busyTimeoutMs: 60 });
  const other = openDatabase(tmp.file, { busyTimeoutMs: 60 });
  let n = 0;
  const repo = new SqliteTaskRepository(db, {
    now: c.now,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    onChange: (e) => events.push(e),
  });
  const count = () => (other.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
  return {
    ...tmp,
    c,
    db,
    other,
    repo,
    events,
    count,
    close() {
      mock.restoreAll();
      if (other.isTransaction) other.exec('ROLLBACK');
      db.close();
      other.close();
      tmp.cleanup();
    },
  };
}

/** Cria uma concluída e a deixa vencida (31 dias depois). */
async function seedExpired(t: ReturnType<typeof setup>, title = 'velha') {
  const r = await t.repo.create(title);
  assert.ok(r.ok);
  if (!r.ok) throw new Error('create falhou');
  await t.repo.complete(r.value.id);
  t.c.advance(31 * DAY);
  t.events.length = 0;
  return r.value.id;
}

// ── Durabilidade (synchronous) ────────────────────────────────────────────────────────────
test('durabilidade: a conexão abre com synchronous=FULL (2), WAL e foreign_keys', () => {
  const tmp = tempFile();
  const db = openDatabase(tmp.file);
  try {
    assert.equal(SYNCHRONOUS_FULL, 2);
    assert.equal(readPragma(db, 'synchronous'), 2);
    const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    assert.equal(mode.journal_mode, 'wal');
    assert.equal(readPragma(db, 'foreign_keys'), 1);
  } finally {
    db.close();
    tmp.cleanup();
  }
});

test('durabilidade: o PRAGMA vale por conexão, então toda abertura o define (reabrir e 2ª conexão)', () => {
  const tmp = tempFile();
  const a = openDatabase(tmp.file);
  const b = openDatabase(tmp.file); // segunda conexão simultânea
  assert.equal(readPragma(a, 'synchronous'), 2);
  assert.equal(readPragma(b, 'synchronous'), 2);
  a.close();
  b.close();
  const c = openDatabase(tmp.file); // reabertura
  assert.equal(readPragma(c, 'synchronous'), 2);
  c.close();
  tmp.cleanup();
});

test('durabilidade: readPragma distingue NORMAL de FULL (a verificação não é decorativa)', () => {
  const tmp = tempFile();
  fs.mkdirSync(path.dirname(tmp.file), { recursive: true });
  const raw = new RawDatabase(tmp.file);
  raw.exec('PRAGMA synchronous = NORMAL');
  assert.equal(readPragma(raw, 'synchronous'), 1);
  raw.exec('PRAGMA synchronous = FULL');
  assert.equal(readPragma(raw, 'synchronous'), 2);
  raw.close();
  tmp.cleanup();
});

test('durabilidade: o que foi confirmado é visível a outra conexão sem fechar a primeira', async () => {
  const t = setup();
  try {
    const r = await t.repo.create('confirmada');
    assert.ok(r.ok);
    assert.equal(t.count(), 1, 'outra conexão enxerga o commit (WAL com fsync a cada commit)');
  } finally {
    t.close();
  }
});

// ── list()/get() sem transação de escrita quando nada expirou ─────────────────────────────
test('list(): sem expiradas NÃO abre transação de escrita', async () => {
  const t = setup();
  try {
    await t.repo.create('ativa');
    const done = await t.repo.create('concluída recente');
    assert.ok(done.ok);
    if (done.ok) await t.repo.complete(done.value.id);
    const calls = spyExec(t.db);
    const lists = await t.repo.list();
    assert.equal(lists.active.length + lists.completed.length, 2);
    assert.equal(writeTransactions(calls), 0, `SQL executado: ${JSON.stringify(calls)}`);
    assert.deepEqual(calls, [], 'nem BEGIN, nem COMMIT: só leitura');
  } finally {
    t.close();
  }
});

test('list(): sem expiradas funciona mesmo com outra conexão segurando o lock de escrita', async () => {
  const t = setup();
  try {
    await t.repo.create('ativa');
    t.other.exec('BEGIN IMMEDIATE'); // outra conexão ocupa a escrita
    const started = performance.now();
    const lists = await t.repo.list();
    const elapsed = performance.now() - started;
    assert.equal(lists.active.length, 1);
    assert.ok(elapsed < 55, `leitura não esperou o lock (${elapsed.toFixed(0)} ms; busy_timeout=60 ms)`);
  } finally {
    t.close();
  }
});

test('list(): com expiradas faz UMA transação, apaga, avisa uma vez; a seguinte já é só leitura', async () => {
  const t = setup();
  try {
    await seedExpired(t);
    const calls = spyExec(t.db);
    const lists = await t.repo.list();
    assert.equal(lists.completed.length, 0);
    assert.equal(writeTransactions(calls), 1);
    assert.deepEqual(calls.filter((c) => c === 'COMMIT').length, 1);
    assert.equal(t.count(), 0, 'a linha foi apagada do banco');
    assert.deepEqual(t.events, [{ type: 'purged', count: 1 }]);

    calls.length = 0;
    await t.repo.list();
    assert.equal(writeTransactions(calls), 0, 'sem novas expiradas: nenhuma escrita');
  } finally {
    t.close();
  }
});

test('list(): com expiradas e escrita bloqueada não falha, não mostra expiradas e adia a limpeza', async () => {
  const t = setup();
  const logged = mock.method(console, 'error', () => {});
  try {
    await t.repo.create('ativa');
    await seedExpired(t);
    t.other.exec('BEGIN IMMEDIATE');
    const lists = await t.repo.list(); // não pode lançar
    assert.equal(lists.completed.length, 0, 'a expirada não aparece mesmo sem poder limpar');
    assert.equal(lists.active.length, 1);
    assert.equal(t.count(), 2, 'a linha ainda existe (limpeza adiada)');
    assert.ok(logged.mock.callCount() >= 1, 'o adiamento foi registrado');
    assert.deepEqual(t.events, []);

    t.other.exec('ROLLBACK'); // libera a escrita
    await t.repo.list();
    assert.equal(t.count(), 1, 'na próxima leitura a limpeza acontece');
    assert.deepEqual(t.events, [{ type: 'purged', count: 1 }]);
  } finally {
    t.close();
  }
});

test('get(): sem expiradas só lê; expirada não é encontrada nem com a escrita bloqueada', async () => {
  const t = setup();
  const logged = mock.method(console, 'error', () => {});
  try {
    const keep = await t.repo.create('ativa');
    assert.ok(keep.ok);
    if (!keep.ok) return;
    const calls = spyExec(t.db);
    const found = await t.repo.get(keep.value.id);
    assert.ok(found.ok);
    assert.equal(writeTransactions(calls), 0);

    const oldId = await seedExpired(t, 'expira');
    t.other.exec('BEGIN IMMEDIATE');
    const gone = await t.repo.get(oldId);
    assert.ok(!gone.ok && gone.error.code === 'not_found');
    assert.ok(logged.mock.callCount() >= 1);
  } finally {
    t.close();
  }
});

test('purgeExpired(): sem expiradas retorna 0 sem transação; com expiradas apaga e avisa', async () => {
  const t = setup();
  try {
    await t.repo.create('ativa');
    const calls = spyExec(t.db);
    assert.equal(t.repo.purgeExpired(), 0);
    assert.equal(writeTransactions(calls), 0);

    await seedExpired(t);
    assert.equal(t.repo.purgeExpired(), 1);
    assert.deepEqual(t.events, [{ type: 'purged', count: 1 }]);
  } finally {
    t.close();
  }
});

// ── Corridas entre a verificação e o DELETE ──────────────────────────────────────────────
test('corrida: tarefa reaberta por outra conexão entre a verificação e o DELETE NÃO é apagada', async () => {
  const t = setup();
  try {
    const id = await seedExpired(t);
    let injected = false;
    spyExec(t.db, (sql) => {
      if (sql === 'BEGIN IMMEDIATE' && !injected) {
        injected = true;
        // Depois de `hasExpired` dizer "sim" e antes do DELETE, outro processo reabre a tarefa.
        t.other.exec(
          `UPDATE tasks SET completed = 0, completed_at = NULL, updated_at = '2026-02-15T00:00:00.000Z' WHERE id = '${id}'`,
        );
      }
    });
    const lists = await t.repo.list();
    assert.ok(injected, 'a janela de corrida foi exercitada');
    assert.equal(t.count(), 1, 'a tarefa continua no banco');
    assert.deepEqual(
      lists.active.map((x) => x.id),
      [id],
    );
    assert.deepEqual(t.events, [], 'nada foi apagado, então nenhum aviso de limpeza');
  } finally {
    t.close();
  }
});

test('corrida: tarefa removida por outra conexão entre a verificação e o DELETE não gera erro', async () => {
  const t = setup();
  try {
    const id = await seedExpired(t);
    let injected = false;
    spyExec(t.db, (sql) => {
      if (sql === 'BEGIN IMMEDIATE' && !injected) {
        injected = true;
        t.other.exec(`DELETE FROM tasks WHERE id = '${id}'`);
      }
    });
    const lists = await t.repo.list();
    assert.ok(injected);
    assert.equal(lists.active.length + lists.completed.length, 0);
    assert.deepEqual(t.events, []);
  } finally {
    t.close();
  }
});

test('corrida: duas conexões limpando as mesmas expiradas: uma apaga, a outra vê zero, sem erro', async () => {
  const t = setup();
  try {
    await seedExpired(t, 'a');
    await seedExpired(t, 'b');
    const second = new SqliteTaskRepository(t.other, { now: t.c.now });
    const [one, two] = await Promise.all([t.repo.list(), second.list()]);
    assert.equal(one.completed.length + two.completed.length, 0);
    assert.equal(t.count(), 0);
    // O total de linhas apagadas é 2, independente de quem as apagou.
    const purged = t.events.filter((e) => e.type === 'purged').reduce((s, e) => s + (e.type === 'purged' ? e.count : 0), 0);
    assert.ok(purged <= 2);
  } finally {
    t.close();
  }
});

test('mutações continuam aplicando a retenção dentro da própria transação de escrita', async () => {
  const t = setup();
  try {
    await seedExpired(t);
    const calls = spyExec(t.db);
    const created = await t.repo.create('nova');
    assert.ok(created.ok);
    assert.equal(writeTransactions(calls), 1, 'create usa uma única transação (a limpeza vai junto)');
    assert.equal(t.count(), 1, 'a expirada saiu na mesma transação');
  } finally {
    t.close();
  }
});
