import type { SyncRow, Transport } from '../../shared/sync/engine.ts';

/** Resposta mínima de `fetch` que o transporte e o login usam (injetável nos testes). */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;

/** O login expirou ou foi recusado: a pessoa precisa entrar de novo (nada local é apagado). */
export class SyncAuthError extends Error {
  constructor(message = 'Entre na sua conta de novo para continuar sincronizando.') {
    super(message);
    this.name = 'SyncAuthError';
  }
}

export interface SupabaseTransportOptions {
  url: string;
  /** Chave pública (`anon`): identifica o projeto; quem protege os dados são as regras por usuário (RLS). */
  anonKey: string;
  fetch: FetchLike;
  /** Token de acesso atual (renovado por quem chama). */
  token(): Promise<string>;
}

const asNumber = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Envia e baixa registros pelas funções `sync_push` / `sync_pull` / `sync_wipe` do Supabase. */
export class SupabaseTransport implements Transport {
  private readonly o: SupabaseTransportOptions;

  constructor(options: SupabaseTransportOptions) {
    this.o = options;
  }

  private async rpc(name: string, body: unknown): Promise<unknown> {
    const token = await this.o.token();
    let res: FetchResponseLike;
    try {
      res = await this.o.fetch(`${this.o.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: this.o.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('Sem conexão com a internet.');
    }
    if (res.status === 401 || res.status === 403) throw new SyncAuthError();
    if (!res.ok) throw new Error(`O servidor de sincronização não respondeu (código ${res.status}).`);
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  async push(batch: SyncRow[]): Promise<number> {
    return asNumber(await this.rpc('sync_push', { batch }));
  }

  async pull(since: number, limit: number): Promise<SyncRow[]> {
    const data = await this.rpc('sync_pull', { since, max_rows: limit });
    if (!Array.isArray(data)) return [];
    return data.map((r: Record<string, unknown>) => ({
      tbl: String(r.tbl),
      id: String(r.id),
      deleted: r.deleted === true,
      stamp: String(r.stamp ?? ''),
      origin: String(r.origin ?? ''),
      payload: r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null,
      server_seq: asNumber(r.server_seq),
    }));
  }

  /** Apaga os dados da pessoa na nuvem (os locais continuam). */
  async wipe(): Promise<void> {
    await this.rpc('sync_wipe', {});
  }
}
