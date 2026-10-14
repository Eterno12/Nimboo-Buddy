import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, net, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import {
  CALENDAR_MAX_BYTES,
  CALENDAR_MAX_SOURCES,
  EMPTY_CALENDAR,
  type CalendarEvent,
  type CalendarResult,
  type CalendarState,
} from '../shared/calendar';
import {
  CalendarSync,
  FetchError,
  type CacheStore,
  type SecretStore,
} from './calendar/calendarSync';

export interface CalendarService {
  /** Eventos novos (para agendar lembretes) já foram entregues por `onEvents`. */
  close(): void;
}

interface CalendarServiceOptions {
  userDataDir: string;
  isAppUrl(url: string): boolean;
  /** Eventos mudaram (sincronização, remoção): usado pelos lembretes da agenda. */
  onEvents(events: CalendarEvent[]): void;
}

const FETCH_TIMEOUT_MS = 20_000;

/** Endereço guardado criptografado pelo cofre do Windows (DPAPI); sem o cofre, não guarda. */
function createSecretStore(file: string): SecretStore {
  return {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },
    read: () => {
      try {
        return safeStorage.decryptString(fs.readFileSync(file));
      } catch {
        return null; // ausente, corrompido ou de outro usuário do Windows
      }
    },
    write: (secret) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, safeStorage.encryptString(secret));
      fs.renameSync(tmp, file);
    },
    remove: () => fs.rmSync(file, { force: true }),
  };
}

function createCacheStore(file: string): CacheStore {
  return {
    read: () => {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { lastSync?: unknown; events?: unknown };
        if (typeof raw.lastSync !== 'string' || !Array.isArray(raw.events)) return null;
        const events = (raw.events as Partial<CalendarEvent>[]).filter(
          (e): e is CalendarEvent =>
            typeof e?.id === 'string' &&
            typeof e.title === 'string' &&
            typeof e.start === 'string' &&
            typeof e.end === 'string' &&
            typeof e.allDay === 'boolean',
        );
        return { lastSync: raw.lastSync, events };
      } catch {
        return null;
      }
    },
    write: (value) => {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
      fs.renameSync(tmp, file);
    },
    remove: () => fs.rmSync(file, { force: true }),
  };
}

/** Baixa o iCal pelo processo principal (o renderer não tem rede). Mensagens nunca incluem o endereço. */
async function fetchCalendarText(url: string): Promise<string> {
  let response: Response;
  try {
    response = await net.fetch(url, {
      redirect: 'follow',
      headers: { Accept: 'text/calendar, text/plain, */*', 'User-Agent': 'Mochi-Desktop' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if ((error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') {
      throw new FetchError('A agenda demorou demais para responder.');
    }
    throw new FetchError('Sem conexão com a internet.');
  }
  // response.url pode vir vazio no net.fetch do Electron; só recusa quando há URL final e ela não é https.
  if (response.url && !response.url.startsWith('https://')) {
    throw new FetchError('A agenda tentou usar uma conexão sem segurança.');
  }
  if (!response.ok) {
    if ([401, 403, 404, 410].includes(response.status)) {
      throw new FetchError(`A agenda não foi encontrada ou o endereço foi trocado (código ${response.status}).`);
    }
    throw new FetchError(`O servidor da agenda não respondeu (código ${response.status}).`);
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > CALENDAR_MAX_BYTES) throw new FetchError('O arquivo da agenda é grande demais.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > CALENDAR_MAX_BYTES) throw new FetchError('O arquivo da agenda é grande demais.');
  return buffer.toString('utf8');
}

/** Agenda por endereço iCal: IPC (só `configured/host/eventos`, nunca o endereço) e sincronização periódica. */
export function startCalendarService({ userDataDir, isAppUrl, onEvents }: CalendarServiceOptions): CalendarService {
  const broadcast = (state: CalendarState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.calendarChanged, state);
      } catch (error) {
        console.error('Falha ao avisar uma janela sobre a agenda:', error);
      }
    }
  };

  // Gancho SÓ de testes (nunca no app instalado): lê a agenda de um arquivo local em vez da rede.
  const fixtureFile = !app.isPackaged && process.env.MOCHI_E2E_CALENDAR_FILE ? process.env.MOCHI_E2E_CALENDAR_FILE : null;

  // Cada agenda é uma CalendarSync independente (arquivos próprios); a interface vê o resumo.
  const perSlot: CalendarEvent[][] = Array.from({ length: CALENDAR_MAX_SOURCES }, () => []);
  const slotFile = (base: string, ext: string, i: number) => path.join(userDataDir, i === 0 ? base + ext : `${base}-${i}${ext}`);
  const merged = (): CalendarEvent[] => {
    const byId = new Map<string, CalendarEvent>();
    for (const list of perSlot) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()].sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
  };
  const syncs: CalendarSync[] = [];
  const aggregate = (): CalendarState => {
    const states = syncs.map((s) => s.getState());
    const sources = states.flatMap((st, slot) =>
      st.configured ? [{ slot, host: st.host, lastSync: st.lastSync, error: st.error }] : [],
    );
    const syncTimes = sources.map((x) => x.lastSync).filter((t): t is string => t !== null);
    return {
      ...EMPTY_CALENDAR,
      sources,
      configured: sources.length > 0,
      host: sources[0]?.host ?? null,
      lastSync: syncTimes.length > 0 ? syncTimes.sort().at(-1)! : null,
      error: sources.find((x) => x.error)?.error ?? null,
      events: merged(),
      canStore: states[0]?.canStore ?? true,
    };
  };
  for (let i = 0; i < CALENDAR_MAX_SOURCES; i++) {
    syncs.push(
      new CalendarSync({
        secret: createSecretStore(slotFile('calendar-url', '.bin', i)),
        cache: createCacheStore(slotFile('calendar-cache', '.json', i)),
        fetchText: fixtureFile ? async () => fs.readFileSync(fixtureFile, 'utf8') : fetchCalendarText,
        onChange: () => broadcast(aggregate()),
        onEvents: (events) => {
          perSlot[i] = events;
          onEvents(merged());
        },
      }),
    );
  }

  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };
  const denied: CalendarResult<never> = { ok: false, message: 'Remetente não autorizado.' };

  ipcMain.handle(IPC.calendarGet, (event) => (trusted(event) ? aggregate() : null));
  ipcMain.handle(IPC.calendarSetUrl, async (event, url: unknown): Promise<CalendarResult<CalendarState>> => {
    if (!trusted(event)) return denied;
    const free = syncs.findIndex((s) => !s.getState().configured);
    if (free < 0) return { ok: false, message: `Limite de ${CALENDAR_MAX_SOURCES} agendas. Remova uma para conectar outra.` };
    const result = await syncs[free].setUrl(url);
    return result.ok ? { ok: true, value: aggregate() } : result;
  });
  ipcMain.handle(IPC.calendarRemove, async (event, slot: unknown) => {
    if (!trusted(event)) return null;
    if (Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < syncs.length) {
      await syncs[slot as number].clear();
    }
    return aggregate();
  });
  ipcMain.handle(IPC.calendarClear, async (event) => {
    if (!trusted(event)) return null;
    await Promise.all(syncs.map((s) => s.clear()));
    return aggregate();
  });
  ipcMain.handle(IPC.calendarRefresh, async (event) => {
    if (!trusted(event)) return null;
    await Promise.all(syncs.map((s) => s.refresh()));
    return aggregate();
  });

  for (const s of syncs) s.start();

  return {
    close() {
      for (const s of syncs) s.stop();
      for (const channel of [IPC.calendarGet, IPC.calendarSetUrl, IPC.calendarClear, IPC.calendarRemove, IPC.calendarRefresh]) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
