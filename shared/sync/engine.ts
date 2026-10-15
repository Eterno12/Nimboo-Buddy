/**
 * Motor de sincronização (puro): baixa o que mudou, aplica, e envia a fila local. Não conhece Electron,
 * SQLite nem rede: `Transport` e `LocalStore` são injetados (PC, celular e testes usam o mesmo motor).
 *
 * Garantias:
 *  - idempotente: repetir uma sincronização não muda nada;
 *  - a fila só é confirmada até o que o servidor aceitou (queda no meio do lote reenvia, nunca perde);
 *  - banco recuperado de corrupção BAIXA antes de enviar (ausência não é exclusão);
 *  - o que veio da nuvem nunca volta para a fila (sem eco).
 */

export interface SyncRow {
  tbl: string;
  id: string;
  deleted: boolean;
  /** Instante da última edição (ou da exclusão), ISO UTC. */
  stamp: string;
  /** Aparelho da última edição. */
  origin: string;
  payload: Record<string, unknown> | null;
  server_seq?: number;
}

export interface Transport {
  /** Envia um lote (idempotente no servidor). Devolve o cursor do servidor. */
  push(batch: SyncRow[]): Promise<number>;
  /** Registros com `server_seq` maior que `since`, em ordem. */
  pull(since: number, limit: number): Promise<SyncRow[]>;
}

export interface PendingItem {
  seq: number;
  tbl: string;
  id: string;
  op: 'upsert' | 'delete';
}

export interface LocalStore {
  deviceId(): string;
  needsFullPull(): boolean;
  markFullPullDone(): void;
  cursor(): number;
  setCursor(value: number): void;
  firstSyncDone(): boolean;
  markFirstSyncDone(): void;
  enqueueAll(): number;
  pending(limit?: number): PendingItem[];
  ack(upToSeq: number): void;
  readRow(tbl: string, id: string): Record<string, string | number | null> | null;
  tombstone(tbl: string, id: string): { deletedAt: string; origin: string } | null;
  applyUpsert(tbl: string, row: Record<string, string | number | null>): 'applied' | 'ignored';
  applyDelete(tbl: string, id: string, deletedAt: string, origin: string): 'applied' | 'ignored';
}

export interface SyncResult {
  pulled: number;
  applied: number;
  ignored: number;
  pushed: number;
}

export const SYNC_PAGE = 500;

export async function syncOnce(store: LocalStore, transport: Transport): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, applied: 0, ignored: 0, pushed: 0 };
  const device = store.deviceId();

  // Primeira vez: tudo que já existe localmente entra na fila (a regra de conflito resolve o resto).
  if (!store.firstSyncDone()) {
    store.enqueueAll();
    store.markFirstSyncDone();
  }

  // 1. Baixar e aplicar.
  for (;;) {
    const rows = await transport.pull(store.cursor(), SYNC_PAGE);
    let max = store.cursor();
    for (const r of rows) {
      result.pulled++;
      const outcome = r.deleted
        ? store.applyDelete(r.tbl, r.id, r.stamp, r.origin)
        : r.payload
          ? store.applyUpsert(r.tbl, { ...(r.payload as Record<string, string | number | null>), id: r.id, origin: r.origin })
          : 'ignored';
      if (outcome === 'applied') result.applied++;
      else result.ignored++;
      if (typeof r.server_seq === 'number' && r.server_seq > max) max = r.server_seq;
    }
    if (max > store.cursor()) store.setCursor(max);
    if (rows.length < SYNC_PAGE) break;
  }
  if (store.needsFullPull()) store.markFullPullDone();

  // 2. Enviar a fila (confirma só o que o servidor aceitou).
  for (;;) {
    const pending = store.pending(SYNC_PAGE);
    if (pending.length === 0) break;
    const batch: SyncRow[] = [];
    for (const p of pending) {
      if (p.op === 'delete') {
        const tomb = store.tombstone(p.tbl, p.id);
        if (tomb) batch.push({ tbl: p.tbl, id: p.id, deleted: true, stamp: tomb.deletedAt, origin: tomb.origin || device, payload: null });
        continue;
      }
      const row = store.readRow(p.tbl, p.id);
      if (!row) continue; // apagado depois de entrar na fila: a exclusão vem em outro item
      const stamp = String(row.updated_at ?? row.completed_at ?? '');
      batch.push({ tbl: p.tbl, id: p.id, deleted: false, stamp, origin: String(row.origin || device), payload: row });
    }
    if (batch.length > 0) await transport.push(batch);
    result.pushed += batch.length;
    store.ack(pending[pending.length - 1].seq);
    if (pending.length < SYNC_PAGE) break;
  }
  return result;
}
