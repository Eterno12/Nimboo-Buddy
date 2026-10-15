import type { DatabaseSync } from 'node:sqlite';
import { SqliteTaskRepository } from '../../electron/tasks/sqliteTaskRepository.ts';
import { SyncStore } from '../../electron/sync/syncStore.ts';
import { SyncRunner, type RunnerState } from '../../electron/sync/syncRunner.ts';
import { SupabaseAuth, type SessionStorage } from '../../electron/sync/supabaseAuth.ts';
import { SupabaseTransport, type FetchLike } from '../../electron/sync/supabaseTransport.ts';
import { openPersistedDb, type BlobStore, type PersistedDb } from '../db/persistence.ts';
import type { SqlJsModule } from '../db/sqlJsDatabase.ts';
import { SYNC_IDLE_INTERVAL_MS, SYNC_TICK_MS } from '../../shared/sync/config.ts';
import { FocusTimer } from '../../electron/focus/focusTimer.ts';
import { FocusLog } from '../../electron/focus/focusLog.ts';
import { DEFAULT_FOCUS_CONFIG, type FocusConfig, type FocusState, type FocusStats } from '../../shared/focus.ts';
import { silentNotifier, type Notifier } from './platform/notifier.ts';

export interface CoreOptions {
  SQL: SqlJsModule;
  blob: BlobStore;
  session: SessionStorage;
  fetch: FetchLike;
  url: string;
  anonKey: string;
  debounceMs?: number;
  /** Avisos do sistema (fim do foco). Padrão: nenhum. */
  notifier?: Notifier;
  /** Relógio (ms); injetável nos testes. */
  now?: () => number;
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
  /** Temporizador de foco (o mesmo do PC); a sessão sobrevive ao fechar o app. */
  focus: FocusTimer;
  focusConfig(): FocusConfig;
  setFocusConfig(config: FocusConfig): void;
  /** Focos concluídos hoje. */
  focusToday(): FocusStats;
  notifier: Notifier;
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

  const now = o.now ?? (() => Date.now());
  const notifier = o.notifier ?? silentNotifier;
  const focusLog = new FocusLog(asNode);

  const metaGet = (key: string) =>
    (persisted.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  const metaSet = (key: string, value: string) =>
    persisted.db
      .prepare('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);

  const prefGet = (key: string) => metaGet(`pref_${key}`);
  const prefSet = (key: string, value: string) => metaSet(`pref_${key}`, value);

  const readFocusConfig = (): FocusConfig => {
    try {
      const raw = JSON.parse(prefGet('focus_config') ?? '{}') as Partial<FocusConfig>;
      const num = (v: unknown, fallback: number, min: number, max: number) =>
        typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
      return {
        focusMinutes: num(raw.focusMinutes, DEFAULT_FOCUS_CONFIG.focusMinutes, 1, 180),
        breakMinutes: num(raw.breakMinutes, DEFAULT_FOCUS_CONFIG.breakMinutes, 1, 60),
        longBreakMinutes: num(raw.longBreakMinutes, DEFAULT_FOCUS_CONFIG.longBreakMinutes, 1, 60),
        cycle: raw.cycle === true,
        autoAdvance: false,
      };
    } catch {
      return { ...DEFAULT_FOCUS_CONFIG };
    }
  };

  let focusEndScheduled = false;
  const syncFocusNotice = (state: FocusState) => {
    if (state.status === 'running' && state.endsAt !== null) {
      focusEndScheduled = true;
      void notifier.scheduleFocusEnd(state.endsAt, state.kind);
    } else if (focusEndScheduled) {
      focusEndScheduled = false;
      void notifier.cancelFocusEnd();
    }
  };

  const focus = new FocusTimer({
    now,
    config: readFocusConfig(),
    onChange: (state) => {
      // Guarda sessões em andamento/pausadas para retomar depois; no repouso ou concluída, limpa.
      if (state.status === 'running' || state.status === 'paused') prefSet('focus_state', JSON.stringify(state));
      else prefSet('focus_state', '');
      syncFocusNotice(state);
      emit();
    },
    onFinished: (kind, session) => {
      focusLog.record({ kind, minutes: session.minutes, taskId: session.task?.id ?? null, at: new Date(session.at) });
      try {
        navigator.vibrate?.(kind === 'focus' ? [200, 100, 200] : [120]);
      } catch {
        /* sem vibração (testes/navegador) */
      }
      emit();
    },
  });
  // Retoma uma sessão que estava rodando quando o app foi fechado.
  try {
    const saved = prefGet('focus_state');
    if (saved) focus.restore(JSON.parse(saved) as FocusState);
  } catch {
    /* estado ilegível: começa em repouso */
  }

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
    focus,
    focusConfig: readFocusConfig,
    setFocusConfig(config) {
      prefSet('focus_config', JSON.stringify(config));
      focus.configure(config);
      emit();
    },
    focusToday: () => focusLog.today(new Date(now())),
    notifier,
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
    close: async () => {
      focus.dispose();
      await persisted.close();
    },
  };
}
