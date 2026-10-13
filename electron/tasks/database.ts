import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { migrate, MIGRATIONS, type Migration } from './migrations.ts';

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

/** Abre (e prepara) a conexão: pragmas de segurança/desempenho e migrações. */
function openAndPrepare(filePath: string, options: OpenDatabaseOptions): DatabaseSync {
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
    migrate(db, options.migrations ?? MIGRATIONS);
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
 */
export function openDatabase(filePath: string, options: OpenDatabaseOptions = {}): DatabaseSync {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    return openAndPrepare(filePath, options);
  } catch (error) {
    if (!isCorruption(error)) throw error;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.renameSync(`${filePath}${suffix}`, `${filePath}.corrupt-${stamp}${suffix}`);
      } catch {
        /* arquivo auxiliar inexistente */
      }
    }
    return openAndPrepare(filePath, options);
  }
}
