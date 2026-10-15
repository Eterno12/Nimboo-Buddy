import { createRoot } from 'react-dom/client';
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { App } from './App';
import { createCore, type Core } from './core';
import { indexedDbBlobStore, localSessionStorage } from './platform/web';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../shared/sync/config';
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
    const core = await createCore({
      SQL,
      blob: indexedDbBlobStore(),
      session: localSessionStorage(),
      fetch: (u, init) => fetch(u, init),
      url,
      anonKey: SUPABASE_ANON_KEY,
    });
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
