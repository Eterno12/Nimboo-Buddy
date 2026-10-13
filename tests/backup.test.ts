import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BACKUPS_TO_KEEP, openDatabase, openDatabaseDetailed } from '../electron/tasks/database.ts';
import { MIGRATIONS, type Migration } from '../electron/tasks/migrations.ts';

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-backup-'));
  return { dir, file: path.join(dir, 'data', 'mochi.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Versões "futuras", acima das migrações reais, para testar a cópia antes de migrar. */
const NEXT = MIGRATIONS.length + 1;
const V2: Migration = {
  version: NEXT,
  name: 'add_note_column',
  up(db) {
    db.exec('ALTER TABLE tasks ADD COLUMN note TEXT');
  },
};
const V3: Migration = {
  version: NEXT + 1,
  name: 'add_tag_column',
  up(db) {
    db.exec('ALTER TABLE tasks ADD COLUMN tag TEXT');
  },
};

const backups = (file: string) =>
  fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('mochi.db.bak-v'));

function seed(file: string, title = 'tarefa importante') {
  const db = openDatabase(file);
  db.prepare(
    `INSERT INTO tasks (id, title, completed, created_at, completed_at, updated_at)
     VALUES ('11111111-1111-4111-8111-111111111111', ?, 0, '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z')`,
  ).run(title);
  db.close();
}

test('banco novo: nenhuma cópia (não há o que proteger)', () => {
  const t = tempDb();
  try {
    const r = openDatabaseDetailed(t.file);
    assert.equal(r.backupPath, null);
    assert.equal(r.recoveredFrom, null);
    r.db.close();
    assert.deepEqual(backups(t.file), []);
  } finally {
    t.cleanup();
  }
});

test('banco existente na versão atual: reabrir não cria cópia', () => {
  const t = tempDb();
  try {
    seed(t.file);
    const r = openDatabaseDetailed(t.file);
    assert.equal(r.backupPath, null);
    r.db.close();
    assert.deepEqual(backups(t.file), []);
  } finally {
    t.cleanup();
  }
});

test('migração de banco existente: cópia ANTES de migrar, com os dados, e o original migra', () => {
  const t = tempDb();
  try {
    seed(t.file);
    const r = openDatabaseDetailed(t.file, { migrations: [...MIGRATIONS, V2] });
    assert.ok(r.backupPath, 'deve informar o caminho da cópia');
    assert.match(path.basename(r.backupPath!), new RegExp('^mochi\\.db\\.bak-v' + MIGRATIONS.length + '-'));
    // O original foi migrado…
    const cols = r.db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
    assert.ok(cols.some((c) => c.name === 'note'));
    assert.equal((r.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, NEXT);
    r.db.close();
    // …e a cópia é o banco antigo, íntegro e legível, ainda na v1.
    const copy = new DatabaseSync(r.backupPath!, { readOnly: true });
    try {
      assert.equal((copy.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, MIGRATIONS.length);
      const rows = copy.prepare('SELECT title FROM tasks').all() as { title: string }[];
      assert.deepEqual(rows.map((x) => x.title), ['tarefa importante']);
      const copyCols = copy.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
      assert.ok(!copyCols.some((c) => c.name === 'note'), 'a cópia não tem a coluna nova');
    } finally {
      copy.close();
    }
  } finally {
    t.cleanup();
  }
});

test('só as cópias mais recentes são mantidas', () => {
  const t = tempDb();
  try {
    seed(t.file);
    const all: Migration[] = [...MIGRATIONS, V2, V3];
    // Sobe uma versão por vez; cada subida cria uma cópia. Antes disso, planta cópias antigas.
    fs.writeFileSync(`${t.file}.bak-v1-2020-01-01T00-00-00-000Z`, 'x');
    fs.writeFileSync(`${t.file}.bak-v1-2020-01-02T00-00-00-000Z`, 'x');
    fs.writeFileSync(`${t.file}.bak-v1-2020-01-03T00-00-00-000Z`, 'x');
    openDatabase(t.file, { migrations: all.slice(0, NEXT) }).close();
    openDatabase(t.file, { migrations: all }).close();
    const left = backups(t.file);
    assert.equal(left.length, BACKUPS_TO_KEEP);
    assert.ok(!left.some((n) => n.includes('2020-01-01')), 'a mais antiga foi descartada');
    assert.ok(left.some((n) => n.startsWith('mochi.db.bak-v' + NEXT + '-')), 'a mais recente foi mantida');
  } finally {
    t.cleanup();
  }
});

test('migração que falha deixa o banco intacto e a cópia existe', () => {
  const t = tempDb();
  try {
    seed(t.file);
    const broken: Migration = {
      version: NEXT,
      name: 'quebra_no_meio',
      up(db) {
        db.exec('ALTER TABLE tasks ADD COLUMN note TEXT');
        throw new Error('falha proposital');
      },
    };
    assert.throws(() => openDatabase(t.file, { migrations: [...MIGRATIONS, broken] }), /falha proposital/);
    assert.equal(backups(t.file).length, 1);
    const db = openDatabase(t.file); // volta a abrir com as migrações reais
    try {
      const cols = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
      assert.ok(!cols.some((c) => c.name === 'note'), 'a transação foi desfeita');
      assert.equal((db.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n, 1);
    } finally {
      db.close();
    }
  } finally {
    t.cleanup();
  }
});

test('arquivo corrompido: é preservado e o app recebe o aviso (recoveredFrom)', () => {
  const t = tempDb();
  try {
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    fs.writeFileSync(t.file, 'isto nao e um banco sqlite, apenas lixo'.repeat(200));
    const r = openDatabaseDetailed(t.file);
    try {
      assert.ok(r.recoveredFrom, 'deve apontar onde o arquivo antigo ficou');
      assert.ok(fs.existsSync(r.recoveredFrom!), 'o arquivo corrompido foi preservado');
      assert.match(path.basename(r.recoveredFrom!), /^mochi\.db\.corrupt-/);
      assert.equal((r.db.prepare('SELECT count(*) AS n FROM tasks').get() as { n: number }).n, 0);
    } finally {
      r.db.close();
    }
  } finally {
    t.cleanup();
  }
});
