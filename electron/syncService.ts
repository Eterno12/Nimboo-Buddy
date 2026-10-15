import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, net, safeStorage, type IpcMainInvokeEvent } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import { IPC } from '../shared/ipc';
import { SUPABASE_ANON_KEY, SUPABASE_URL, SYNC_IDLE_INTERVAL_MS, SYNC_TICK_MS } from '../shared/sync/config';
import type { SyncResultMessage, SyncState } from '../shared/sync/state';
import { SyncStore } from './sync/syncStore';
import { SyncRunner } from './sync/syncRunner';
import { SupabaseAuth, type SessionStorage } from './sync/supabaseAuth';
import { SupabaseTransport, type FetchLike } from './sync/supabaseTransport';

export interface SyncService {
  /** Preferências mudaram (ligar/desligar): reavalia na hora. */
  kick(): void;
  close(): void;
}

interface Options {
  db: DatabaseSync;
  userDataDir: string;
  isAppUrl(url: string): boolean;
  /** Sincronização ligada nas preferências? */
  enabled(): boolean;
  /** Registros vindos da nuvem mudaram o banco: as janelas precisam recarregar. */
  onApplied(): void;
}

/** Sessão guardada cifrada pelo cofre do Windows (DPAPI); sem o cofre, não guarda nada. */
function sessionStorage(file: string): SessionStorage & { available(): boolean } {
  const available = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };
  return {
    available,
    read: () => {
      try {
        return safeStorage.decryptString(fs.readFileSync(file));
      } catch {
        return null;
      }
    },
    write: (value) => {
      if (!available()) throw new Error('cofre indisponível');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, safeStorage.encryptString(value));
      fs.renameSync(tmp, file);
    },
    clear: () => fs.rmSync(file, { force: true }),
  };
}

/** `net.fetch` do Electron com o formato mínimo que o login e o transporte usam. */
const electronFetch: FetchLike = async (url, init) => {
  const res = await net.fetch(url, {
    method: init?.method,
    headers: init?.headers,
    body: init?.body,
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: res.ok, status: res.status, json: () => res.json(), text: () => res.text() };
};

/**
 * Sincronização com o Supabase (D55): login por código, envio/recebimento periódico e IPC. Tudo desligado
 * até a pessoa entrar numa conta e ligar a opção. Só o processo principal fala com o servidor.
 */
export function startSyncService({ db, userDataDir, isAppUrl, enabled, onApplied }: Options): SyncService {
  // Gancho SÓ de testes (app não empacotado): servidor falso em http://127.0.0.1.
  const testUrl = !app.isPackaged ? process.env.MOCHI_E2E_SYNC_URL : undefined;
  const url = testUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(testUrl) ? testUrl : SUPABASE_URL;

  const storage = sessionStorage(path.join(userDataDir, 'sync-session.bin'));
  const auth = new SupabaseAuth({ url, anonKey: SUPABASE_ANON_KEY, fetch: electronFetch, storage });
  const transport = new SupabaseTransport({ url, anonKey: SUPABASE_ANON_KEY, fetch: electronFetch, token: () => auth.accessToken() });
  const store = new SyncStore(db);

  const snapshot = (): SyncState => {
    const r = runner.state();
    const account = auth.account();
    const on = enabled();
    return {
      canStore: storage.available(),
      account: account ? { email: account.email } : null,
      enabled: on,
      status: !account || !on ? 'off' : r.status,
      lastSync: r.lastSync,
      error: r.error,
      pending: store.pending(1000).length,
    };
  };

  const broadcast = () => {
    const state = snapshot();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.syncChanged, state);
      } catch (error) {
        console.error('Falha ao avisar uma janela sobre a sincronização:', error);
      }
    }
  };

  const runner = new SyncRunner({
    store,
    transport,
    canRun: () => enabled() && auth.account() !== null,
    onApplied: () => onApplied(),
    onState: broadcast,
  });

  let lastRun = 0;
  const tick = () => {
    if (!enabled() || !auth.account()) return;
    const due = Date.now() - lastRun >= SYNC_IDLE_INTERVAL_MS;
    if (due || store.pending(1).length > 0) {
      lastRun = Date.now();
      void runner.run();
    }
  };
  const timer = setInterval(tick, SYNC_TICK_MS);
  timer.unref();
  setTimeout(tick, 2000).unref();

  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };
  const denied: SyncResultMessage = { ok: false, message: 'Remetente não autorizado.' };

  ipcMain.handle(IPC.syncGet, (event) => (trusted(event) ? snapshot() : null));
  ipcMain.handle(IPC.syncRequestCode, async (event, email: unknown): Promise<SyncResultMessage> => {
    if (!trusted(event)) return denied;
    if (!storage.available()) return { ok: false, message: 'O cofre de senhas do Windows não está disponível; não dá para guardar o login com segurança.' };
    return auth.requestCode(String(email ?? ''));
  });
  ipcMain.handle(IPC.syncVerify, async (event, email: unknown, code: unknown): Promise<SyncResultMessage> => {
    if (!trusted(event)) return denied;
    const result = await auth.verifyCode(String(email ?? ''), String(code ?? ''));
    broadcast();
    return result;
  });
  ipcMain.handle(IPC.syncNow, async (event): Promise<SyncState | null> => {
    if (!trusted(event)) return null;
    lastRun = Date.now();
    await runner.run();
    return snapshot();
  });
  ipcMain.handle(IPC.syncSignOut, async (event): Promise<SyncState | null> => {
    if (!trusted(event)) return null;
    await auth.signOut();
    runner.reset();
    broadcast();
    return snapshot();
  });
  ipcMain.handle(IPC.syncWipe, async (event): Promise<SyncResultMessage> => {
    if (!trusted(event)) return denied;
    if (!auth.account()) return { ok: false, message: 'Entre na sua conta primeiro.' };
    try {
      await transport.wipe();
      // O servidor ficou vazio: na próxima vez, tudo que existe aqui sobe de novo.
      store.setCursor(0);
      store.resetFirstSync();
      broadcast();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Não foi possível apagar agora.' };
    }
  });

  return {
    kick() {
      lastRun = 0;
      broadcast();
      setTimeout(tick, 200).unref();
    },
    close() {
      clearInterval(timer);
      for (const c of [IPC.syncGet, IPC.syncRequestCode, IPC.syncVerify, IPC.syncNow, IPC.syncSignOut, IPC.syncWipe]) {
        ipcMain.removeHandler(c);
      }
    },
  };
}
