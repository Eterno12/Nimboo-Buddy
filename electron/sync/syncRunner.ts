import { syncOnce, type LocalStore, type Transport } from '../../shared/sync/engine.ts';
import { SyncAuthError } from './supabaseTransport.ts';

export type RunnerStatus = 'idle' | 'syncing' | 'error' | 'login';

export interface RunnerState {
  status: RunnerStatus;
  /** Última sincronização concluída (ISO UTC). */
  lastSync: string | null;
  /** Mensagem em português da última falha (ou `null`). */
  error: string | null;
}

export interface SyncRunnerOptions {
  store: LocalStore;
  transport: Transport;
  /** Sincronização ligada e com conta? (falso: não chama o servidor). */
  canRun(): boolean;
  /** Quantos registros vindos da nuvem mudaram o banco local (a interface precisa recarregar). */
  onApplied?(count: number): void;
  /** O estado mudou (para avisar as janelas). */
  onState?(state: RunnerState): void;
  now?: () => Date;
}

/** Executa uma sincronização por vez e traduz o resultado em um estado simples para a interface. */
export class SyncRunner {
  private readonly o: SyncRunnerOptions;
  private current: RunnerState = { status: 'idle', lastSync: null, error: null };
  private running: Promise<void> | null = null;

  constructor(options: SyncRunnerOptions) {
    this.o = options;
  }

  state(): RunnerState {
    return { ...this.current };
  }

  private set(next: Partial<RunnerState>): void {
    this.current = { ...this.current, ...next };
    try {
      this.o.onState?.(this.state());
    } catch (error) {
      console.error('Falha ao avisar o estado da sincronização:', error);
    }
  }

  /** Marca que a conta saiu: não há mais o que sincronizar. */
  reset(): void {
    this.set({ status: 'idle', error: null });
  }

  run(): Promise<void> {
    if (this.running) return this.running;
    if (!this.o.canRun()) return Promise.resolve();
    this.set({ status: 'syncing' });
    this.running = (async () => {
      try {
        const result = await syncOnce(this.o.store, this.o.transport);
        this.set({ status: 'idle', lastSync: (this.o.now?.() ?? new Date()).toISOString(), error: null });
        if (result.applied > 0) this.o.onApplied?.(result.applied);
      } catch (error) {
        if (error instanceof SyncAuthError) {
          this.set({ status: 'login', error: error.message });
        } else {
          const message = error instanceof Error && error.message ? error.message : 'Não foi possível sincronizar agora.';
          this.set({ status: 'error', error: message });
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}
