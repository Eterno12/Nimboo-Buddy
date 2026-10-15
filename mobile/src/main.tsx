import { createRoot } from 'react-dom/client';
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { App } from './App';
import { createCore, type Core } from './core';
import { Capacitor } from '@capacitor/core';
import { indexedDbBlobStore, localSessionStorage } from './platform/web';
import { filesystemBlobStore } from './platform/native';
import { nativeNotifier } from './platform/nativeNotifier';
import { nativeWidget } from './platform/nativeWidget';
import { silentNotifier } from './platform/notifier';
import { encryptedSession, indexedDbKeyVault, syncSessionStorage } from './platform/secureSession';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../shared/sync/config';
import { applySound, playSound } from './sound';
import './style.css';

declare global {
  interface Window {
    /** Só para testes e depuração no navegador. */
    __nimboo?: Core;
  }
}

async function boot() {
  const root = createRoot(document.getElementById('root') as HTMLElement);
  try {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    // `?sync=http://127.0.0.1:porta` aponta para um servidor falso (testes); sem isso, o projeto real.
    const override = new URLSearchParams(location.search).get('sync');
    const url = override && /^http:\/\/127\.0\.0\.1:\d+$/.test(override) ? override : SUPABASE_URL;
    // No Android: arquivo no armazenamento privado do app. No navegador (desenvolvimento): IndexedDB.
    const native = Capacitor.isNativePlatform();
    // A sessão (tokens) é sempre cifrada com uma chave não extraível guardada à parte.
    const session = await syncSessionStorage(await encryptedSession(localSessionStorage(), indexedDbKeyVault()));
    const core = await createCore({
      SQL,
      blob: native ? filesystemBlobStore() : indexedDbBlobStore(),
      session,
      fetch: (u, init) => fetch(u, init),
      url,
      anonKey: SUPABASE_ANON_KEY,
      notifier: native ? nativeNotifier() : silentNotifier,
      widget: native ? nativeWidget() : undefined,
      onUnlocked: () => playSound('achievement'),
      onFocusFinished: (kind) => playSound(kind === 'focus' ? 'focusDone' : 'breakDone'),
    });
    applySound(core);
    window.__nimboo = core;
    core.startTimers();
    root.render(<App core={core} />);
  } catch (error) {
    root.render(
      <main className="boot-error">
        <h1>Não foi possível abrir o Nimboo</h1>
        <p>{error instanceof Error ? error.message : 'Erro desconhecido.'}</p>
      </main>,
    );
  }
}

void boot();
