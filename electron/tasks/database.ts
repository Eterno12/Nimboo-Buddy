import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { currentVersion, migrate, MIGRATIONS, type Migration } from './migrations.ts';

export interface OpenDatabaseOptions {
  migrations?: readonly Migration[];
  /** Tempo de espera por um bloqueio de escrita de outra conexão (ms). */
  busyTimeoutMs?: number;
}

/** Valor de PRAGMA synchronous para FULL (0 OFF, 1 NORMAL, 2 FULL, 3 EXTRA). */
export const SYNCHRONOUS_FULL = 2;

/** Lê um PRAGMA (valor numérico). */
export function readPragma(db: DatabaseSync, name: string): number {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, number>;
  return Number(Object.values(row)[0]);
}

/** Garante que a configuração realmente foi aplicada (não presume que o PRAGMA funcionou). */
function assertPragma(db: DatabaseSync, name: string, expected: number): void {
  const actual = readPragma(db, name);
  if (actual !== expected) {
    throw new Error(`PRAGMA ${name} ficou em ${actual}; o esperado era ${expected}`);
  }
}

/** Quantas cópias de segurança (uma por migração) são mantidas ao lado do banco. */
export const BACKUPS_TO_KEEP = 3;

/** Resultado detalhado da abertura: o que o app precisa avisar ao usuário. */
export interface OpenedDatabase {
  db: DatabaseSync;
  /** O arquivo anterior estava corrompido: caminho para onde foi preservado (ou `null`). */
  recoveredFrom: string | null;
  /** Cópia feita antes de migrar o esquema (ou `null` se não houve migração de banco existente). */
  backupPath: string | null;
}

/**
 * Copia o banco antes de uma migração. O WAL é incorporado ao arquivo principal primeiro
 * (`wal_checkpoint(TRUNCATE)`), então a cópia contém tudo. Mantém só as mais recentes.
 */
function backupBeforeMigration(db: DatabaseSync, filePath: string, fromVersion: number): string {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${filePath}.bak-v${fromVersion}-${stamp}`;
  fs.copyFileSync(filePath, target);
  try {
    const dir = path.dirname(filePath);
    const prefix = `${path.basename(filePath)}.bak-v`;
    const old = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(prefix))
      .sort() // o carimbo ISO ordena cronologicamente dentro da mesma versão; entre versões, por nome
      .reverse()
      .slice(BACKUPS_TO_KEEP);
    for (const name of old) fs.unlinkSync(path.join(dir, name));
  } catch {
    /* limpeza de cópias antigas é opcional */
  }
  return target;
}

/** Abre (e prepara) a conexão: pragmas de segurança/desempenho e migrações. */
function openAndPrepare(filePath: string, options: OpenDatabaseOptions, info: { backupPath: string | null }): DatabaseSync {
  const db = new DatabaseSync(filePath);
  try {
    db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 3000}`);
    db.exec('PRAGMA journal_mode = WAL');
    // Durabilidade: com WAL, NORMAL não faz fsync a cada commit e pode perder as últimas
    // transações numa queda de energia (o banco segue íntegro). FULL faz fsync do WAL em
    // cada commit. O custo medido é ~1 ms por escrita, irrelevante para uma lista de
    // tarefas. O PRAGMA vale POR CONEXÃO, então é definido em toda abertura e conferido.
    db.exec('PRAGMA synchronous = FULL');
    assertPragma(db, 'synchronous', SYNCHRONOUS_FULL);
    db.exec('PRAGMA foreign_keys = ON');
    assertPragma(db, 'foreign_keys', 1);
    const migrations = options.migrations ?? MIGRATIONS;
    const from = currentVersion(db);
    // Banco que já existe e vai mudar de esquema: cópia ANTES de tocar nele. Se a cópia
    // falhar, não migra (os dados ficam como estão; o app segue sem tarefas e registra o erro).
    if (from > 0 && from < migrations.length) info.backupPath = backupBeforeMigration(db, filePath, from);
    migrate(db, migrations);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Erros que indicam arquivo inválido/corrompido (e não, por exemplo, banco ocupado). */
function isCorruption(error: unknown): boolean {
  const code = (error as { errcode?: number; code?: string }).errcode;
  // SQLITE_NOTADB (26) e SQLITE_CORRUPT (11), inclusive os códigos estendidos.
  if (typeof code === 'number') return (code & 0xff) === 26 || (code & 0xff) === 11;
  return /not a database|malformed|corrupt/i.test(String((error as Error)?.message));
}

/**
 * Abre o banco de tarefas, criando pastas e esquema quando necessário.
 * Se o arquivo estiver corrompido, ele é preservado ao lado (`.corrupt-<data>`)
 * e um banco novo é criado, em vez de impedir o uso do app. Um banco de versão
 * mais nova (`SchemaTooNewError`) NÃO é tocado: o erro sobe para quem chamou.
 * Antes de migrar um banco existente, faz uma cópia (`.bak-v<versão>-<data>`).
 */
export function openDatabaseDetailed(filePath: string, options: OpenDatabaseOptions = {}): OpenedDatabase {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const info: { backupPath: string | null } = { backupPath: null };
  try {
    return { db: openAndPrepare(filePath, options, info), recoveredFrom: null, backupPath: info.backupPath };
  } catch (error) {
    if (!isCorruption(error)) throw error;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const preserved = `${filePath}.corrupt-${stamp}`;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.renameSync(`${filePath}${suffix}`, `${preserved}${suffix}`);
      } catch {
        /* arquivo auxiliar inexistente */
      }
    }
    info.backupPath = null;
    return { db: openAndPrepare(filePath, options, info), recoveredFrom: preserved, backupPath: null };
  }
}

/** Atalho para quem só precisa da conexão. */
export function openDatabase(filePath: string, options: OpenDatabaseOptions = {}): DatabaseSync {
  return openDatabaseDetailed(filePath, options).db;
}