import {
  EMPTY_BOND,
  RENDERER_EVENTS,
  applyBondEvent,
  buildSnapshot,
  newlyUnlocked,
  type BondEvent,
  type BondSnapshot,
  type BondState,
} from '../../shared/achievements.ts';
import type { SqliteBondStore } from './bondStore.ts';

export interface BondEngineOptions {
  store: Pick<SqliteBondStore, 'load' | 'save' | 'unlock'>;
  now?: () => Date;
  /** Chamado quando uma conquista é desbloqueada (a interface mostra o aviso). */
  onUnlocked?: (ids: string[]) => void;
  /** O estado mudou (a janela de conquistas se atualiza). */
  onChanged?: (snapshot: BondSnapshot) => void;
}

/**
 * Motor do vínculo: aplica eventos, persiste e desbloqueia conquistas. Sem Electron: testável com um
 * armazenamento falso.
 */
export class BondEngine {
  private state: BondState = EMPTY_BOND;
  private unlocked: Record<string, string> = {};
  private affection = 0.5;
  private readonly store: BondEngineOptions['store'];
  private readonly now: () => Date;
  private readonly onUnlocked: (ids: string[]) => void;
  private readonly onChanged: (snapshot: BondSnapshot) => void;

  constructor(options: BondEngineOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.onUnlocked = options.onUnlocked ?? (() => {});
    this.onChanged = options.onChanged ?? (() => {});
    const loaded = this.store.load();
    this.state = loaded.state;
    this.unlocked = loaded.unlocked;
    this.affection = loaded.affection;
  }

  snapshot(): BondSnapshot {
    return buildSnapshot(this.state, this.unlocked, this.affection);
  }

  /** Aceita só os eventos que a interface pode mandar (os demais nascem no processo principal). */
  handleFromRenderer(raw: unknown): boolean {
    if (typeof raw !== 'object' || raw === null) return false;
    const type = (raw as { type?: unknown }).type;
    if (typeof type !== 'string' || !(RENDERER_EVENTS as readonly string[]).includes(type)) return false;
    this.handle({ type } as BondEvent);
    return true;
  }

  handle(event: BondEvent): string[] {
    const when = this.now();
    this.state = applyBondEvent(this.state, event, when);
    const fresh = newlyUnlocked(this.state.stats, new Set(Object.keys(this.unlocked)));
    for (const id of fresh) this.unlocked[id] = when.toISOString();
    try {
      this.store.save(this.state, this.affection);
      for (const id of fresh) this.store.unlock(id, this.unlocked[id]);
    } catch (error) {
      console.error('Falha ao gravar o vínculo/conquistas:', error);
    }
    this.onChanged(this.snapshot());
    if (fresh.length > 0) this.onUnlocked(fresh);
    return fresh;
  }

  saveAffection(value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    this.affection = Math.min(1, Math.max(0, value));
    try {
      this.store.save(this.state, this.affection);
    } catch (error) {
      console.error('Falha ao gravar o afeto:', error);
    }
  }
}
