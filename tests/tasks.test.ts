import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../electron/tasks/database.ts';
import { currentVersion, migrate, MIGRATIONS, SchemaTooNewError, type Migration } from '../electron/tasks/migrations.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { TASK_TITLE_MAX, titleLength, validateTitle, type TaskChange } from '../shared/tasks.ts';

const DAY = 24 * 60 * 60 * 1000;

/** Cada teste usa uma pasta temporária própria; o banco real do app nunca é tocado. */
function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-tasks-'));
  return { dir, file: path.join(dir, 'data', 'mochi.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Relógio controlável. */
function clock(start = '2026-01-01T00:00:00.000Z') {
  let t = new Date(start).getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms), set: (iso: string) => (t = new Date(iso).getTime()) };
}

function setup(opts: { start?: string } = {}) {
  const tmp = tempDb();
  const c = clock(opts.start);
  const events: TaskChange[] = [];
  const db = openDatabase(tmp.file);
  let n = 0;
  const repo = new SqliteTaskRepository(db, {
    now: c.now,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    onChange: (e) => events.push(e),
  });
  return { ...tmp, c, db, repo, events };
}

// 1 ---------------------------------------------------------------------------
test('banco: cria arquivo, aplica migrações e configura WAL', () => {
  const t = setup();
  try {
    assert.ok(fs.existsSync(t.file));
    assert.equal(currentVersion(t.db), MIGRATIONS.length);
    const cols = t.db.prepare('PRAGMA table_info(tasks)').all() as { name: string; notnull: number }[];
    assert.deepEqual(
      cols.map((c) => c.name),
      ['id', 'title', 'completed', 'created_at', 'completed_at', 'updated_at'],
    );
    assert.equal((t.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    assert.equal((t.db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('banco: reabrir não reaplica migrações nem altera dados', async () => {
  const t = setup();
  await t.repo.create('manter');
  t.db.close();
  const again = openDatabase(t.file);
  assert.equal(currentVersion(again), MIGRATIONS.length);
  assert.equal((again.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 1);
  again.close();
  t.cleanup();
});

// 2 ---------------------------------------------------------------------------
test('criar e listar: campos, UTC e ordem de criação', async () => {
  const t = setup({ start: '2026-03-10T10:00:00.000Z' });
  try {
    const a = await t.repo.create('  primeira  ');
    t.c.advance(1000);
    const b = await t.repo.create('segunda');
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.equal(a.value.title, 'primeira'); // espaços das pontas removidos
    assert.equal(a.value.completed, false);
    assert.equal(a.value.completedAt, null);
    assert.equal(a.value.createdAt, '2026-03-10T10:00:00.000Z');
    assert.equal(a.value.updatedAt, a.value.createdAt);
    assert.match(a.value.createdAt, /Z$/);

    const lists = await t.repo.list();
    assert.deepEqual(
      lists.active.map((x) => x.title),
      ['primeira', 'segunda'],
    );
    assert.equal(lists.completed.length, 0);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('ids: UUIDs reais gerados no cliente não colidem', async () => {
  const tmp = tempDb();
  const db = openDatabase(tmp.file);
  const repo = new SqliteTaskRepository(db); // gerador padrão (randomUUID)
  const ids = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const r = await repo.create(`t${i}`);
    assert.ok(r.ok);
    if (r.ok) ids.add(r.value.id);
  }
  assert.equal(ids.size, 300);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  db.close();
  tmp.cleanup();
});

// 3 ---------------------------------------------------------------------------
test('concluir e reabrir: datas, listas e idempotência', async () => {
  const t = setup({ start: '2026-04-01T08:00:00.000Z' });
  try {
    const created = await t.repo.create('estudar');
    assert.ok(created.ok);
    if (!created.ok) return;
    const id = created.value.id;

    t.c.advance(5 * 60 * 1000);
    const done = await t.repo.complete(id);
    assert.ok(done.ok);
    if (!done.ok) return;
    assert.equal(done.value.completed, true);
    assert.equal(done.value.completedAt, '2026-04-01T08:05:00.000Z');
    assert.equal(done.value.updatedAt, '2026-04-01T08:05:00.000Z');
    assert.equal(done.value.createdAt, '2026-04-01T08:00:00.000Z');

    let lists = await t.repo.list();
    assert.equal(lists.active.length, 0);
    assert.deepEqual(
      lists.completed.map((x) => x.id),
      [id],
    );

    // Concluir de novo não muda nada nem gera evento.
    t.events.length = 0;
    t.c.advance(1000);
    const again = await t.repo.complete(id);
    assert.ok(again.ok);
    assert.equal(again.ok && again.value.updatedAt, '2026-04-01T08:05:00.000Z');
    assert.deepEqual(t.events, []);

    t.c.advance(60_000);
    const reopened = await t.repo.reopen(id);
    assert.ok(reopened.ok);
    if (!reopened.ok) return;
    assert.equal(reopened.value.completed, false);
    assert.equal(reopened.value.completedAt, null);
    assert.equal(reopened.value.updatedAt, '2026-04-01T08:06:01.000Z'); // 08:05 + 1 s + 60 s
    lists = await t.repo.list();
    assert.equal(lists.active.length, 1);
    assert.equal(lists.completed.length, 0);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('eventos: só mudanças reais; reabrir e excluir não são "concluída"', async () => {
  const t = setup();
  try {
    const r = await t.repo.create('x');
    assert.ok(r.ok);
    if (!r.ok) return;
    await t.repo.complete(r.value.id);
    await t.repo.reopen(r.value.id);
    await t.repo.remove(r.value.id);
    assert.deepEqual(
      t.events.map((e) => e.type),
      ['created', 'completed', 'reopened', 'removed'],
    );
  } finally {
    t.db.close();
    t.cleanup();
  }
});

// 4 ---------------------------------------------------------------------------
test('excluir: remove ativas e concluídas; id inexistente ou inválido dá erro', async () => {
  const t = setup();
  try {
    const a = await t.repo.create('ativa');
    const b = await t.repo.create('concluida');
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    await t.repo.complete(b.value.id);

    assert.deepEqual(await t.repo.remove(a.value.id), { ok: true, value: null });
    assert.deepEqual(await t.repo.remove(b.value.id), { ok: true, value: null });
    const lists = await t.repo.list();
    assert.equal(lists.active.length + lists.completed.length, 0);

    const missing = await t.repo.remove('00000000-0000-4000-8000-0000000000ff');
    assert.ok(!missing.ok && missing.error.code === 'not_found');
    const invalid = await t.repo.remove("1; DROP TABLE tasks; --");
    assert.ok(!invalid.ok && invalid.error.code === 'invalid_id');
    // A tabela continua intacta.
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 0);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('concluir/reabrir tarefa inexistente ou id inválido', async () => {
  const t = setup();
  try {
    const nf = await t.repo.complete('00000000-0000-4000-8000-0000000000aa');
    assert.ok(!nf.ok && nf.error.code === 'not_found');
    const bad = await t.repo.reopen('nao-e-uuid');
    assert.ok(!bad.ok && bad.error.code === 'invalid_id');
  } finally {
    t.db.close();
    t.cleanup();
  }
});

// 5 ---------------------------------------------------------------------------
test('persistência: dados sobrevivem a fechar e reabrir a conexão', async () => {
  const t = setup({ start: '2026-05-01T00:00:00.000Z' });
  const a = await t.repo.create('ativa');
  const b = await t.repo.create('feita');
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  await t.repo.complete(b.value.id);
  t.db.close();

  const db2 = openDatabase(t.file);
  const repo2 = new SqliteTaskRepository(db2, { now: t.c.now });
  const lists = await repo2.list();
  assert.deepEqual(
    lists.active.map((x) => x.title),
    ['ativa'],
  );
  assert.deepEqual(
    lists.completed.map((x) => x.title),
    ['feita'],
  );
  assert.equal(lists.completed[0].completedAt, '2026-05-01T00:00:00.000Z');
  db2.close();
  t.cleanup();
});

// 6 ---------------------------------------------------------------------------
test('validação: vazio, só espaços, muito longo, tipo errado', async () => {
  const t = setup();
  try {
    for (const bad of ['', '   ', '\n\t ']) {
      const r = await t.repo.create(bad);
      assert.ok(!r.ok && r.error.code === 'title_empty');
    }
    const long = await t.repo.create('a'.repeat(TASK_TITLE_MAX + 1));
    assert.ok(!long.ok && long.error.code === 'title_too_long');
    const wrongType = await t.repo.create(42 as unknown as string);
    assert.ok(!wrongType.ok && wrongType.error.code === 'invalid_title');
    // Nada foi gravado.
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 0);
    assert.deepEqual(t.events, []);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('validação: exatamente 200 caracteres passa; emoji conta como 1; espaços das pontas não contam', async () => {
  assert.ok(validateTitle('a'.repeat(200)).ok);
  assert.ok(validateTitle('😀'.repeat(200)).ok);
  assert.ok(!validateTitle('😀'.repeat(201)).ok);
  assert.ok(validateTitle(`  ${'a'.repeat(200)}  `).ok);
  const t = setup();
  try {
    const r = await t.repo.create('a'.repeat(200));
    assert.ok(r.ok);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('segurança: títulos com SQL/aspas são guardados literalmente', async () => {
  const t = setup();
  try {
    const nasty = `Robert'); DROP TABLE tasks;--`;
    const r = await t.repo.create(nasty);
    assert.ok(r.ok);
    const lists = await t.repo.list();
    assert.equal(lists.active[0].title, nasty);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

// 7 e 8 -----------------------------------------------------------------------
test('retenção: concluída é mantida por 30 dias e removida depois', async () => {
  const t = setup({ start: '2026-06-01T12:00:00.000Z' });
  try {
    const r = await t.repo.create('antiga');
    assert.ok(r.ok);
    if (!r.ok) return;
    await t.repo.complete(r.value.id); // concluída em 2026-06-01T12:00:00.000Z

    t.c.advance(29 * DAY + 23 * 60 * 60 * 1000);
    assert.equal((await t.repo.list()).completed.length, 1, 'com 29d23h ainda existe');

    t.c.advance(60 * 60 * 1000); // exatamente 30 dias
    assert.equal((await t.repo.list()).completed.length, 1, 'com exatamente 30 dias ainda existe');

    t.c.advance(1); // 30 dias + 1 ms
    t.events.length = 0;
    const lists = await t.repo.list();
    assert.equal(lists.completed.length, 0, 'passou de 30 dias: removida');
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 0);
    assert.deepEqual(t.events, [{ type: 'purged', count: 1 }]);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('retenção: o prazo conta de completed_at, não de created_at; reabrir zera', async () => {
  const t = setup({ start: '2026-01-01T00:00:00.000Z' });
  try {
    const a = await t.repo.create('criada há muito, concluída agora');
    assert.ok(a.ok);
    if (!a.ok) return;
    t.c.advance(100 * DAY);
    await t.repo.complete(a.value.id);
    t.c.advance(10 * DAY);
    assert.equal((await t.repo.list()).completed.length, 1, 'criada há 110 dias, concluída há 10: fica');

    // Reabre e conclui de novo: o novo completed_at reinicia o prazo.
    await t.repo.reopen(a.value.id);
    t.c.advance(20 * DAY);
    await t.repo.complete(a.value.id);
    t.c.advance(29 * DAY);
    assert.equal((await t.repo.list()).completed.length, 1);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('retenção: tarefas ativas nunca são removidas, mesmo muito antigas', async () => {
  const t = setup({ start: '2024-01-01T00:00:00.000Z' });
  try {
    const active = await t.repo.create('ativa antiga');
    const done = await t.repo.create('concluída antiga');
    assert.ok(active.ok && done.ok);
    if (!active.ok || !done.ok) return;
    await t.repo.complete(done.value.id);
    t.c.advance(800 * DAY);
    const lists = await t.repo.list();
    assert.deepEqual(
      lists.active.map((x) => x.title),
      ['ativa antiga'],
    );
    assert.equal(lists.completed.length, 0);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('retenção: limpeza na inicialização (purgeExpired) e durante atualizações', async () => {
  const t = setup({ start: '2026-02-01T00:00:00.000Z' });
  try {
    const old = await t.repo.create('velha');
    const keep = await t.repo.create('fica');
    assert.ok(old.ok && keep.ok);
    if (!old.ok || !keep.ok) return;
    await t.repo.complete(old.value.id);
    t.c.advance(31 * DAY);
    await t.repo.complete(keep.value.id);

    // Uma mutação qualquer também limpa as expiradas.
    const other = await t.repo.create('nova');
    assert.ok(other.ok);
    const rows = t.db.prepare('SELECT title FROM tasks ORDER BY title').all() as { title: string }[];
    assert.deepEqual(
      rows.map((r) => r.title),
      ['fica', 'nova'],
    );
    // Sem nada expirado, a limpeza explícita não remove nem avisa.
    t.events.length = 0;
    assert.equal(t.repo.purgeExpired(), 0);
    assert.deepEqual(t.events, []);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

// 9 ---------------------------------------------------------------------------
test('concorrência: 200 criações simultâneas na mesma conexão', async () => {
  const t = setup();
  try {
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => t.repo.create(`tarefa ${i}`)));
    assert.ok(results.every((r) => r.ok));
    const lists = await t.repo.list();
    assert.equal(lists.active.length, 200);
    assert.equal(new Set(lists.active.map((x) => x.id)).size, 200);
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('concorrência: duas conexões intercaladas no mesmo arquivo', async () => {
  const tmp = tempDb();
  const db1 = openDatabase(tmp.file);
  const db2 = openDatabase(tmp.file);
  const r1 = new SqliteTaskRepository(db1);
  const r2 = new SqliteTaskRepository(db2);
  const created: string[] = [];
  for (let i = 0; i < 50; i++) {
    const [a, b] = await Promise.all([r1.create(`a${i}`), r2.create(`b${i}`)]);
    assert.ok(a.ok && b.ok);
    if (a.ok && b.ok) created.push(a.value.id, b.value.id);
  }
  // Uma conexão conclui o que a outra criou.
  for (const id of created.slice(0, 20)) assert.ok((await r2.complete(id)).ok);
  const lists = await r1.list();
  assert.equal(lists.active.length + lists.completed.length, 100);
  assert.equal(lists.completed.length, 20);
  assert.equal((db1.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  db1.close();
  db2.close();
  tmp.cleanup();
});

test('concorrência: três PROCESSOS escrevendo ao mesmo tempo no mesmo banco', async () => {
  const tmp = tempDb();
  openDatabase(tmp.file).close(); // cria o esquema antes
  const writer = path.resolve('tests/helpers/taskWriter.ts');
  const run = (prefix: string) =>
    new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, [writer, tmp.file, '40', prefix], { stdio: ['ignore', 'ignore', 'inherit'] });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? -1));
    });
  const codes = await Promise.all([run('p1'), run('p2'), run('p3')]);
  assert.deepEqual(codes, [0, 0, 0]);

  const db = openDatabase(tmp.file);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 120);
  assert.equal((db.prepare('SELECT COUNT(DISTINCT id) AS n FROM tasks').get() as { n: number }).n, 120);
  assert.equal((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  db.close();
  tmp.cleanup();
});

test('transação: falha no meio desfaz tudo (rollback)', () => {
  const tmp = tempDb();
  const db = openDatabase(tmp.file);
  db.exec(`INSERT INTO tasks (id, title, completed, created_at, completed_at, updated_at)
           VALUES ('00000000-0000-4000-8000-000000000001','x',0,'2026-01-01T00:00:00.000Z',NULL,'2026-01-01T00:00:00.000Z')`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`UPDATE tasks SET title = 'alterado'`);
    // Viola o CHECK (completed = 1 exige completed_at) e lança.
    db.exec(`UPDATE tasks SET completed = 1`);
    assert.fail('deveria ter lançado');
  } catch {
    db.exec('ROLLBACK');
  }
  assert.equal((db.prepare('SELECT title FROM tasks').get() as { title: string }).title, 'x');
  db.close();
  tmp.cleanup();
});

// 10 --------------------------------------------------------------------------
const V2: Migration = {
  version: 2,
  name: 'add_note_column',
  up(db) {
    db.exec(`ALTER TABLE tasks ADD COLUMN note TEXT NOT NULL DEFAULT ''`);
  },
};

test('migração: evoluir o esquema (v1 → v2) preserva os dados existentes', async () => {
  const t = setup({ start: '2026-07-01T00:00:00.000Z' });
  const a = await t.repo.create('ativa');
  const b = await t.repo.create('feita');
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  await t.repo.complete(b.value.id);
  t.db.close();

  const db2 = openDatabase(t.file, { migrations: [...MIGRATIONS, V2] });
  assert.equal(currentVersion(db2), 2);
  const rows = db2.prepare('SELECT id, title, completed, completed_at, note FROM tasks ORDER BY title').all() as {
    id: string;
    title: string;
    completed: number;
    completed_at: string | null;
    note: string;
  }[];
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.title, r.completed, r.note]),
    [
      ['ativa', 0, ''],
      ['feita', 1, ''],
    ],
  );
  assert.equal(rows[1].completed_at, '2026-07-01T00:00:00.000Z');
  db2.close();
  t.cleanup();
});

test('migração: falha numa migração desfaz tudo e mantém a versão anterior', async () => {
  const t = setup();
  await t.repo.create('segura');
  t.db.close();
  const broken: Migration = {
    version: 2,
    name: 'quebrada',
    up(db) {
      db.exec('ALTER TABLE tasks ADD COLUMN extra TEXT');
      throw new Error('falha proposital');
    },
  };
  assert.throws(() => openDatabase(t.file, { migrations: [...MIGRATIONS, broken] }), /falha proposital/);
  const db = openDatabase(t.file);
  assert.equal(currentVersion(db), 1);
  const cols = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.includes('extra'), 'a coluna parcial foi desfeita');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 1);
  db.close();
  t.cleanup();
});

test('migração: banco de versão mais nova é recusado sem ser alterado', async () => {
  const t = setup();
  await t.repo.create('futuro');
  t.db.exec('PRAGMA user_version = 99');
  t.db.close();
  assert.throws(() => openDatabase(t.file), (e) => e instanceof SchemaTooNewError && e.found === 99);
  // O arquivo não foi renomeado nem apagado.
  const db = new DatabaseSync(t.file);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 1);
  db.close();
  t.cleanup();
});

test('migração: lista de migrações fora de ordem é rejeitada', () => {
  const tmp = tempDb();
  const db = new DatabaseSync(path.join(tmp.dir, 'x.db'));
  assert.throws(() => migrate(db, [{ version: 2, name: 'pulou', up() {} }]), /fora de ordem/);
  db.close();
  tmp.cleanup();
});

test('recuperação: arquivo corrompido é preservado e um banco novo é criado', () => {
  const tmp = tempDb();
  fs.mkdirSync(path.dirname(tmp.file), { recursive: true });
  fs.writeFileSync(tmp.file, 'isto não é um banco sqlite, é lixo '.repeat(50));
  const db = openDatabase(tmp.file);
  assert.equal(currentVersion(db), MIGRATIONS.length);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 0);
  db.close();
  const kept = fs.readdirSync(path.dirname(tmp.file)).filter((f) => f.includes('.corrupt-'));
  assert.equal(kept.length, 1, 'o arquivo corrompido foi guardado ao lado');
  tmp.cleanup();
});

// Correções da revisão -----------------------------------------------------------
test('notificação: falha do ouvinte DEPOIS do commit não faz a operação parecer malsucedida', async () => {
  const tmp = tempDb();
  const db = openDatabase(tmp.file);
  const c = clock();
  const boom = () => {
    throw new Error('janela destruída');
  };
  const repo = new SqliteTaskRepository(db, { now: c.now, onChange: boom });
  const logged = mock.method(console, 'error', () => {});
  try {
    const created = await repo.create('mesmo com falha ao avisar');
    assert.ok(created.ok, 'create segue ok');
    if (!created.ok) return;
    assert.ok((await repo.complete(created.value.id)).ok);
    assert.ok((await repo.reopen(created.value.id)).ok);
    assert.ok((await repo.complete(created.value.id)).ok);
    assert.equal((await repo.list()).completed.length, 1);
    assert.ok((await repo.remove(created.value.id)).ok);
    // Tudo foi confirmado no banco...
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, 0);
    // ...e cada falha de notificação foi registrada (5 mudanças: create, complete, reopen, complete, remove).
    assert.equal(logged.mock.callCount(), 5);
    assert.match(String(logged.mock.calls[0].arguments[0]), /notificar/);
  } finally {
    logged.mock.restore();
    db.close();
    tmp.cleanup();
  }
});

test('notificação: falha ao avisar a limpeza (purged) não quebra list() nem get()', async () => {
  const tmp = tempDb();
  const db = openDatabase(tmp.file);
  const c = clock('2026-01-01T00:00:00.000Z');
  let armed = false;
  const repo = new SqliteTaskRepository(db, {
    now: c.now,
    onChange: () => {
      if (armed) throw new Error('falha ao notificar');
    },
  });
  const logged = mock.method(console, 'error', () => {});
  try {
    const a = await repo.create('velha');
    assert.ok(a.ok);
    if (!a.ok) return;
    await repo.complete(a.value.id);
    c.advance(31 * DAY);
    armed = true;
    const lists = await repo.list(); // purga e tenta notificar
    assert.equal(lists.completed.length, 0);
    assert.ok(logged.mock.callCount() >= 1);
  } finally {
    logged.mock.restore();
    db.close();
    tmp.cleanup();
  }
});

test('get: devolve a tarefa; concluída expirada não existe mais e é limpa', async () => {
  const t = setup({ start: '2026-02-01T00:00:00.000Z' });
  try {
    const r = await t.repo.create('buscar');
    assert.ok(r.ok);
    if (!r.ok) return;
    const found = await t.repo.get(r.value.id);
    assert.ok(found.ok && found.value.title === 'buscar');

    await t.repo.complete(r.value.id);
    t.c.advance(30 * DAY + 1);
    t.events.length = 0;
    const gone = await t.repo.get(r.value.id);
    assert.ok(!gone.ok && gone.error.code === 'not_found');
    assert.deepEqual(t.events, [{ type: 'purged', count: 1 }]);

    const bad = await t.repo.get('xyz');
    assert.ok(!bad.ok && bad.error.code === 'invalid_id');
  } finally {
    t.db.close();
    t.cleanup();
  }
});

test('titleLength: conta pontos de código sem os espaços das pontas (base do contador)', () => {
  assert.equal(titleLength(''), 0);
  assert.equal(titleLength('   '), 0);
  assert.equal(titleLength('  abc  '), 3);
  assert.equal(titleLength('😀😀'), 2);
  assert.equal(titleLength('a'.repeat(250)), 250);
  // O contador da interface e a validação do backend usam a mesma função.
  assert.ok(validateTitle('a'.repeat(250)).ok === false);
  assert.ok(validateTitle(`${'a'.repeat(200)}   `).ok === true);
});