import type { SyncRow, Transport } from '../../shared/sync/engine.ts';

/** Servidor falso com a MESMA regra de conflito do SQL (supabase/migrations/0001_sync.sql). */
export class FakeServer {
  rows = new Map<string, SyncRow & { server_seq: number }>();
  seq = 0;
  failNext = 0;
  pushes = 0;

  transport(): Transport {
    return {
      push: async (batch) => {
        if (this.failNext > 0) {
          this.failNext--;
          throw new Error('sem rede');
        }
        this.pushes++;
        for (const r of batch) {
          const key = `${r.tbl}:${r.id}`;
          const cur = this.rows.get(key);
          const wins =
            !cur ||
            r.stamp > cur.stamp ||
            (r.stamp === cur.stamp && r.deleted && !cur.deleted) ||
            (r.stamp === cur.stamp && r.deleted === cur.deleted && r.origin > cur.origin);
          if (wins) this.rows.set(key, { ...r, payload: r.deleted ? null : r.payload, server_seq: ++this.seq });
        }
        return this.seq;
      },
      pull: async (since, limit) => {
        if (this.failNext > 0) {
          this.failNext--;
          throw new Error('sem rede');
        }
        return [...this.rows.values()].filter((r) => r.server_seq > since).sort((a, b) => a.server_seq - b.server_seq).slice(0, limit);
      },
    };
  }
}
