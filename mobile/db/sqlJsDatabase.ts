/**
 * Adaptador com a API do `node:sqlite` (`DatabaseSync`) sobre o sql.js (SQLite em WASM). Serve para o app
 * Android reutilizar, sem reescrever, as migrações, os repositórios, os gatilhos da fila de envio e o
 * `SyncStore` do PC. Só implementa o que esses módulos usam: `exec`, `prepare().get/all/run`,
 * `isTransaction`, `close`.
 *
 * Limite conhecido: o banco vive em memória; a persistência (arquivo) fica em `persistence.ts`.
 */

/** Subconjunto do sql.js que o adaptador usa (o pacote não traz tipos próprios). */
export interface SqlJsStatement {
  bind(values?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): boolean;
}
export interface SqlJsRaw {
  run(sql: string, params?: unknown[]): unknown;
  exec(sql: string): unknown;
  prepare(sql: string): SqlJsStatement;
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}
export interface SqlJsModule {
  Database: new (data?: Uint8Array) => SqlJsRaw;
}

type Param = string | number | bigint | null | Uint8Array | undefined;
export type SqlRow = Record<string, unknown>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

const BEGIN_RE = /^\s*BEGIN\b/i;
const END_RE = /^\s*(COMMIT|END|ROLLBACK)\b(?!\s+TO\b)/i;

export class SqlJsStatementAdapter {
  private readonly db: SqlJsDatabase;
  private readonly sql: string;

  constructor(db: SqlJsDatabase, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  private clean(params: Param[]): unknown[] {
    return params.map((p) => (p === undefined ? null : typeof p === 'bigint' ? Number(p) : p));
  }

  get(...params: Param[]): SqlRow | undefined {
    const stmt = this.db.raw.prepare(this.sql);
    try {
      stmt.bind(this.clean(params));
      return stmt.step() ? { ...stmt.getAsObject() } : undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params: Param[]): SqlRow[] {
    const stmt = this.db.raw.prepare(this.sql);
    try {
      stmt.bind(this.clean(params));
      const rows: SqlRow[] = [];
      while (stmt.step()) rows.push({ ...stmt.getAsObject() });
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(...params: Param[]): RunResult {
    this.db.raw.run(this.sql, this.clean(params));
    // Escrita fora de transação confirma na hora; dentro dela, quem confirma é o COMMIT.
    if (!this.db.isTransaction) this.db.notifyCommit();
    const info = this.db.raw.exec('SELECT last_insert_rowid() AS id') as { values: unknown[][] }[];
    return { changes: this.db.raw.getRowsModified(), lastInsertRowid: Number(info[0]?.values[0]?.[0] ?? 0) };
  }
}

export class SqlJsDatabase {
  readonly raw: SqlJsRaw;
  private inTransaction = false;
  /** Chamado quando uma escrita foi confirmada (COMMIT ou escrita avulsa): quem persiste o arquivo agenda a gravação. */
  onCommit: (() => void) | null = null;

  constructor(SQL: SqlJsModule, bytes?: Uint8Array) {
    this.raw = new SQL.Database(bytes);
  }

  /** Há uma transação aberta (BEGIN sem COMMIT/ROLLBACK)? */
  get isTransaction(): boolean {
    return this.inTransaction;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
    // Controle de transação por texto: basta para os usos do app (um BEGIN/COMMIT por chamada).
    if (BEGIN_RE.test(sql)) this.inTransaction = true;
    else if (END_RE.test(sql)) {
      this.inTransaction = false;
      if (!/^\s*ROLLBACK\b/i.test(sql)) this.notifyCommit();
    }
  }

  notifyCommit(): void {
    try {
      this.onCommit?.();
    } catch (error) {
      console.error('Falha ao agendar a gravação do banco:', error);
    }
  }

  prepare(sql: string): SqlJsStatementAdapter {
    return new SqlJsStatementAdapter(this, sql);
  }

  /** Cópia do banco inteiro (formato do arquivo SQLite). */
  export(): Uint8Array {
    return this.raw.export();
  }

  close(): void {
    this.raw.close();
  }
}
