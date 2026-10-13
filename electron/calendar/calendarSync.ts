import {
  CALENDAR_DAYS_AHEAD,
  CALENDAR_MAX_BYTES,
  EMPTY_CALENDAR,
  validateCalendarUrl,
  type CalendarEvent,
  type CalendarResult,
  type CalendarState,
} from '../../shared/calendar.ts';
import { expandEvents } from './ics.ts';

/** Armazenamento de um segredo (o endereço da agenda): criptografado pelo cofre do Windows. */
export interface SecretStore {
  /** Cofre disponível (DPAPI). Sem ele o endereço NÃO é guardado. */
  available(): boolean;
  read(): string | null;
  write(secret: string): void;
  remove(): void;
}

/** Cópia local dos últimos eventos (a agenda aparece mesmo sem internet ao abrir o app). */
export interface CacheStore {
  read(): { lastSync: string; events: CalendarEvent[] } | null;
  write(value: { lastSync: string; events: CalendarEvent[] }): void;
  remove(): void;
}

export interface CalendarSyncOptions {
  secret: SecretStore;
  cache: CacheStore;
  /** Baixa o texto do endereço (injetável; no app usa `net.fetch`). Lança `FetchError` com mensagem amigável. */
  fetchText(url: string): Promise<string>;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Intervalo entre sincronizações automáticas. */
  intervalMs?: number;
  /** Eventos novos (depois de cada sincronização ou mudança). */
  onEvents?: (events: CalendarEvent[]) => void;
  /** Estado mudou (para avisar as janelas). */
  onChange?: (state: CalendarState) => void;
}

/** Falha de rede/arquivo já com texto para a pessoa (nunca contém o endereço). */
export class FetchError extends Error {}

export const SYNC_INTERVAL_MS = 15 * 60_000;

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/**
 * Mantém a agenda sincronizada: guarda o endereço (criptografado), baixa de tempos em tempos, converte
 * em eventos dos próximos dias e mantém uma cópia local. Falhas nunca apagam o que já foi baixado.
 */
export class CalendarSync {
  private url: string | null = null;
  private state: CalendarState = { ...EMPTY_CALENDAR, events: [] };
  private timer: unknown = undefined;
  private refreshing: Promise<void> | null = null;
  private readonly opts: Required<Pick<CalendarSyncOptions, 'now' | 'setTimer' | 'clearTimer' | 'intervalMs'>> &
    CalendarSyncOptions;

  constructor(options: CalendarSyncOptions) {
    this.opts = {
      now: () => new Date(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      intervalMs: SYNC_INTERVAL_MS,
      ...options,
    };
    this.state.canStore = options.secret.available();
  }

  getState(): CalendarState {
    return { ...this.state, events: [...this.state.events] };
  }

  /** Lê o endereço salvo e a cópia local; agenda a sincronização periódica. */
  start(): void {
    try {
      this.url = this.opts.secret.available() ? this.opts.secret.read() : null;
    } catch {
      this.url = null;
    }
    if (this.url) {
      const cached = this.opts.cache.read();
      this.state = {
        ...this.state,
        configured: true,
        host: hostOf(this.url),
        lastSync: cached?.lastSync ?? null,
        events: cached ? this.visible(cached.events) : [],
      };
      this.publish();
      void this.refresh();
      this.schedule();
    }
  }

  stop(): void {
    if (this.timer !== undefined) this.opts.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** Salva o endereço (validado) e sincroniza já. */
  async setUrl(input: unknown): Promise<CalendarResult<CalendarState>> {
    const valid = validateCalendarUrl(input);
    if (!valid.ok) return valid;
    if (!this.opts.secret.available()) {
      return { ok: false, message: 'O cofre de senhas do Windows não está disponível; o endereço não pode ser guardado com segurança.' };
    }
    try {
      this.opts.secret.write(valid.value);
    } catch {
      return { ok: false, message: 'Não foi possível guardar o endereço com segurança.' };
    }
    this.url = valid.value;
    this.state = { ...this.state, configured: true, host: hostOf(valid.value), error: null, events: [], lastSync: null };
    this.publish();
    await this.refresh();
    this.schedule();
    const s = this.getState();
    // Primeira leitura falhou (endereço errado): desfaz, para não deixar um endereço inútil guardado.
    if (s.error && s.lastSync === null) {
      const message = s.error;
      await this.clear();
      return { ok: false, message };
    }
    return { ok: true, value: s };
  }

  /** Remove o endereço, a cópia local e os eventos. */
  async clear(): Promise<CalendarState> {
    this.stop();
    this.url = null;
    try {
      this.opts.secret.remove();
      this.opts.cache.remove();
    } catch {
      /* já removidos */
    }
    this.state = { ...EMPTY_CALENDAR, events: [], canStore: this.opts.secret.available() };
    this.publish();
    return this.getState();
  }

  /** Baixa de novo. Chamadas simultâneas compartilham a mesma tentativa. */
  refresh(): Promise<void> {
    if (!this.url) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    const url = this.url;
    this.refreshing = (async () => {
      try {
        const text = await this.opts.fetchText(url);
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new FetchError('Esse endereço não é uma agenda no formato iCal.');
        if (this.url !== url) return; // trocado/removido durante o download
        const events = this.window(text);
        const lastSync = this.opts.now().toISOString();
        this.state = { ...this.state, events, lastSync, error: null };
        try {
          this.opts.cache.write({ lastSync, events });
        } catch {
          /* cópia local é só um bônus */
        }
        this.opts.onEvents?.(events);
      } catch (error) {
        if (this.url !== url) return;
        const message = error instanceof FetchError ? error.message : 'Não foi possível atualizar a agenda agora.';
        this.state = { ...this.state, error: message };
      } finally {
        this.refreshing = null;
        this.publish();
      }
    })();
    return this.refreshing;
  }

  private window(text: string): CalendarEvent[] {
    const now = this.opts.now();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + CALENDAR_DAYS_AHEAD).getTime();
    return expandEvents(text, from, to);
  }

  /** Da cópia local, só o que ainda interessa (hoje em diante). */
  private visible(events: CalendarEvent[]): CalendarEvent[] {
    const now = this.opts.now();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return events.filter((e) => Date.parse(e.end) > from);
  }

  private schedule(): void {
    this.stop();
    this.timer = this.opts.setTimer(() => {
      void this.refresh().finally(() => {
        if (this.url) this.schedule();
      });
    }, this.opts.intervalMs);
  }

  private publish(): void {
    this.opts.onChange?.(this.getState());
    if (this.state.configured) this.opts.onEvents?.(this.state.events);
    else this.opts.onEvents?.([]);
  }
}

export { CALENDAR_MAX_BYTES };
