import type { DatabaseSync } from 'node:sqlite';
import { SqliteTaskRepository } from '../../electron/tasks/sqliteTaskRepository';
import { SyncStore } from '../../electron/sync/syncStore';
import { SyncRunner, type RunnerState } from '../../electron/sync/syncRunner';
import { SupabaseAuth, type SessionStorage } from '../../electron/sync/supabaseAuth';
import { SupabaseTransport, type FetchLike } from '../../electron/sync/supabaseTransport';
import { openPersistedDb, type BlobStore, type PersistedDb } from '../db/persistence';
import type { SqlJsModule } from '../db/sqlJsDatabase';
import { SYNC_IDLE_INTERVAL_MS, SYNC_TICK_MS } from '../../shared/sync/config';

export interface CoreOptions {
  SQL: SqlJsModule;
  blob: BlobStore;
  session: SessionStorage;
  fetch: FetchLike;
  url: string;
  anonKey: string;
  debounceMs?: number;
}

/** Tudo que o app do celular precisa, sem depender de React: banco, tarefas, conta e sincronização. */
export interface Core {
  tasks: SqliteTaskRepository;
  store: SyncStore;
  auth: SupabaseAuth;
  recovered: boolean;
  syncEnabled(): boolean;
  setSyncEnabled(value: boolean): void;
  /** Preferências locais do aparelho (personagem, cor...), guardadas no mesmo banco. */
  getPref(key: string): string | null;
  setPref(key: string, value: string): void;
  syncState(): RunnerState;
  /** Sincroniza agora (nada acontece sem conta e sem consentimento). */
  syncNow(): Promise<void>;
  /** Avisa quando dados ou estado mudam (para a interface recarregar). */
  subscribe(listener: () => void): () => void;
  flush(): Promise<void>;
  /** Liga verificação periódica (a cada 15 s: envia se há fila; a cada 60 s: baixa). */
  startTimers(): () => void;
  close(): Promise<void>;
}

export async function createCore(o: CoreOptions): Promise<Core> {
  const persisted: PersistedDb = await openPersistedDb(o.SQL, o.blob, { debounceMs: o.debounceMs ?? 300 });
  const asNode = persisted.db as unknown as DatabaseSync;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  const tasks = new SqliteTaskRepository(asNode, { onChange: emit });
  const store = new SyncStore(asNode);
  const auth = new SupabaseAuth({ url: o.url, anonKey: o.anonKey, fetch: o.fetch, storage: o.session });
  const transport = new SupabaseTransport({ url: o.url, anonKey: o.anonKey, fetch: o.fetch, token: () => auth.accessToken() });

  const metaGet = (key: string) =>
    (persisted.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  const metaSet = (key: string, value: string) =>
    persisted.db
      .prepare('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);

  const enabled = () => metaGet('enabled') === '1';
  const runner = new SyncRunner({
    store,
    transport,
    canRun: () => enabled() && auth.account() !== null,
    onApplied: emit,
    onState: emit,
  });

  let lastRun = 0;
  const tick = () => {
    if (!enabled() || !auth.account()) return;
    if (Date.now() - lastRun >= SYNC_IDLE_INTERVAL_MS || store.pending(1).length > 0) {
      lastRun = Date.now();
      void runner.run();
    }
  };

  return {
    tasks,
    store,
    auth,
    recovered: persisted.recovered,
    syncEnabled: enabled,
    getPref: (key) => metaGet(`pref_${key}`),
    setPref(key, value) {
      metaSet(`pref_${key}`, value);
      emit();
    },
    setSyncEnabled(value) {
      metaSet('enabled', value ? '1' : '0');
      lastRun = 0;
      emit();
      if (value) setTimeout(tick, 100);
    },
    syncState: () => runner.state(),
    async syncNow() {
      lastRun = Date.now();
      await runner.run();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: () => persisted.flush(),
    startTimers() {
      const t = setInterval(tick, SYNC_TICK_MS);
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') void persisted.flush();
        else tick();
      };
      const onHide = () => void persisted.flush();
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onHide);
      setTimeout(tick, 1500);
      return () => {
        clearInterval(t);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', onHide);
      };
    },
    close: () => persisted.close(),
  };
}
