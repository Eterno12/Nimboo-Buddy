import type { DatabaseSync } from 'node:sqlite';
import { isNewer, type Stamp } from '../../shared/sync/merge.ts';
import { isTaskId, validateTitle } from '../../shared/tasks.ts';

/** Tabelas que sincronizam e as colunas que viajam (nada além disso é aceito do outro lado). */
const TABLES = {
  tasks: ['id', 'title', 'completed', 'created_at', 'completed_at', 'updated_at', 'due_at', 'source_ref', 'priority', 'recurrence', 'parent_id', 'position', 'origin'],
  notes: ['id', 'title', 'preview', 'plain', 'doc', 'color', 'pinned', 'win_x', 'win_y', 'win_w', 'win_h', 'created_at', 'updated_at', 'task_id', 'event_ref', 'origin'],
  focus_sessions: ['id', 'kind', 'minutes', 'completed_at', 'task_id', 'origin'],
} as const;

export type SyncTable = keyof typeof TABLES;
export const SYNC_TABLES = Object.keys(TABLES) as SyncTable[];

export interface PendingChange {
  seq: number;
  tbl: SyncTable;
  id: string;
  op: 'upsert' | 'delete';
}

export type ApplyResult = 'applied' | 'ignored';
type Row = Record<string, string | number | null>;

const isTable = (t: string): t is SyncTable => Object.hasOwn(TABLES, t);

/**
 * Lado local da sincronização: fila de saída, marcas de exclusão e aplicação do que vem da nuvem.
 * A fila e as marcas são mantidas por gatilhos do banco (migração v9); aqui só se lê e se confirma.
 * O que é aplicado vindo da nuvem roda com `sync_ctx.suppress = 1`, então nunca volta para a fila.
 */
export class SyncStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private meta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  deviceId(): string {
    return this.meta('device_id') ?? '';
  }

  /** Banco recuperado de corrupção: precisa baixar tudo antes de enviar qualquer coisa (ausência ≠ exclusão). */
  needsFullPull(): boolean {
    return this.meta('needs_full_pull') === '1';
  }

  markFullPullDone(): void {
    this.setMeta('needs_full_pull', '0');
  }

  /** Cursor de leitura (o `server_seq` do último registro baixado). */
  cursor(): number {
    return Number(this.meta('cursor') ?? 0);
  }

  setCursor(value: number): void {
    this.setMeta('cursor', String(value));
  }

  /** A primeira sincronização já enfileirou tudo que existia antes? */
  firstSyncDone(): boolean {
    return this.meta('first_sync') === '1';
  }

  markFirstSyncDone(): void {
    this.setMeta('first_sync', '1');
  }

  /** Depois de apagar a nuvem: a próxima sincronização envia tudo de novo. */
  resetFirstSync(): void {
    this.setMeta('first_sync', '0');
  }

  /** Marca de exclusão de um registro (para enviar a exclusão com o horário certo). */
  tombstone(tbl: string, id: string): { deletedAt: string; origin: string } | null {
    const row = this.db.prepare('SELECT deleted_at, origin FROM tombstones WHERE tbl = ? AND id = ?').get(tbl, id) as
      | { deleted_at: string; origin: string | null }
      | undefined;
    return row ? { deletedAt: row.deleted_at, origin: row.origin ?? '' } : null;
  }

  /** Mudanças ainda não enviadas, compactadas: um item por registro (o mais recente). */
  pending(limit = 500): PendingChange[] {
    return this.db
      .prepare(
        `SELECT o.seq, o.tbl, o.id, o.op FROM outbox o
         WHERE o.seq = (SELECT MAX(seq) FROM outbox WHERE tbl = o.tbl AND id = o.id)
         ORDER BY o.seq LIMIT ?`,
      )
      .all(limit) as unknown as PendingChange[];
  }

  /** Confirma o envio: remove da fila tudo até `seq` (o que entrou depois continua pendente). */
  ack(upToSeq: number): void {
    this.db.prepare('DELETE FROM outbox WHERE seq <= ?').run(upToSeq);
  }

  /** O registro como será enviado (`null` se já não existe). O aparelho de origem sempre vai preenchido. */
  readRow(tbl: SyncTable, id: string): Row | null {
    if (!isTable(tbl)) return null;
    const row = this.db.prepare(`SELECT ${TABLES[tbl].join(', ')} FROM ${tbl} WHERE id = ?`).get(id) as Row | undefined;
    if (!row) return null;
    return { ...row, origin: row.origin ?? this.deviceId() };
  }

  /** Primeira sincronização: tudo que já existe localmente entra na fila de envio. */
  enqueueAll(): number {
    let total = 0;
    for (const tbl of SYNC_TABLES) {
      const r = this.db
        .prepare(`INSERT INTO outbox (tbl, id, op, at) SELECT '${tbl}', id, 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM ${tbl}`)
        .run();
      total += Number(r.changes);
    }
    return total;
  }

  private quiet<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('UPDATE sync_ctx SET suppress = 1');
      const result = fn();
      this.db.exec('UPDATE sync_ctx SET suppress = 0');
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private stampOf(tbl: SyncTable, id: string): Stamp | null {
    if (tbl === 'focus_sessions') {
      const exists = this.db.prepare('SELECT 1 AS x FROM focus_sessions WHERE id = ?').get(id);
      return exists ? { updatedAt: '9999', origin: '' } : null; // sessões são imutáveis: a local sempre vence
    }
    const row = this.db.prepare(`SELECT updated_at, origin FROM ${tbl} WHERE id = ?`).get(id) as { updated_at: string; origin: string | null } | undefined;
    return row ? { updatedAt: row.updated_at, origin: row.origin ?? '' } : null;
  }

  /** Aplica um registro vindo da nuvem. Valida o formato e respeita a regra de conflito e as marcas de exclusão. */
  applyUpsert(tbl: string, incoming: Row): ApplyResult {
    if (!isTable(tbl) || typeof incoming.id !== 'string' || !isTaskId(incoming.id)) return 'ignored';
    if (tbl === 'tasks' && !validateTitle(incoming.title).ok) return 'ignored';
    const cols = TABLES[tbl];
    const incomingAt = String(incoming.updated_at ?? incoming.completed_at ?? '');
    const stamp: Stamp = { updatedAt: incomingAt, origin: String(incoming.origin ?? '') };
    const tomb = this.db.prepare('SELECT deleted_at FROM tombstones WHERE tbl = ? AND id = ?').get(tbl, incoming.id) as { deleted_at: string } | undefined;
    // Exclusão vale sobre cópias mais antigas (ou do mesmo instante): só uma edição POSTERIOR ressuscita.
    if (tomb && !(stamp.updatedAt > tomb.deleted_at)) return 'ignored';
    const local = this.stampOf(tbl, incoming.id);
    if (local && !isNewer(stamp, local)) return 'ignored';
    const values = cols.map((c) => (incoming[c] === undefined ? null : incoming[c]) as string | number | null);
    try {
      this.quiet(() => {
        if (tomb) this.db.prepare('DELETE FROM tombstones WHERE tbl = ? AND id = ?').run(tbl, incoming.id as string);
        this.db
          .prepare(`INSERT OR REPLACE INTO ${tbl} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...values);
      });
    } catch (error) {
      console.error(`Registro remoto recusado em ${tbl}:`, error);
      return 'ignored';
    }
    return 'applied';
  }

  /** Aplica uma exclusão vinda da nuvem (uma edição local posterior à exclusão a anula). */
  applyDelete(tbl: string, id: string, deletedAt: string, origin: string): ApplyResult {
    if (!isTable(tbl) || !isTaskId(id)) return 'ignored';
    const local = this.stampOf(tbl, id);
    if (local && isNewer(local, { updatedAt: deletedAt, origin })) return 'ignored';
    this.quiet(() => {
      this.db.prepare(`DELETE FROM ${tbl} WHERE id = ?`).run(id);
      this.db
        .prepare('INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at, origin) VALUES (?, ?, ?, ?)')
        .run(tbl, id, deletedAt, origin);
    });
    return 'applied';
  }
}
