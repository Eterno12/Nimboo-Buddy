import type { BlobStore } from '../../db/persistence';
import type { SessionStorage } from '../../../electron/sync/supabaseAuth';

const DB_NAME = 'nimboo';
const STORE = 'files';

function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        open.result.close();
        resolve(req.result);
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    };
  });
}

/** Arquivo do banco no IndexedDB (navegador / desenvolvimento). No Android a parte nativa grava em arquivo. */
export function indexedDbBlobStore(key = 'nimboo.db'): BlobStore {
  return {
    read: async () => {
      const value = await idb<unknown>((s) => s.get(key), 'readonly');
      return value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
    },
    write: async (bytes) => {
      await idb((s) => s.put(bytes, key), 'readwrite');
    },
    preserveCorrupt: async (bytes) => {
      await idb((s) => s.put(bytes, `${key}.corrupt-${Date.now()}`), 'readwrite');
    },
  };
}

/** Sessão em `localStorage` (só desenvolvimento; no Android vira o cofre do sistema). */
export function localSessionStorage(key = 'nimboo.session'): SessionStorage {
  return {
    read: () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write: (value) => localStorage.setItem(key, value),
    clear: () => localStorage.removeItem(key),
  };
}
