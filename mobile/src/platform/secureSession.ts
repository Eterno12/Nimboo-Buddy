import { base64ToBytes, bytesToBase64 } from './base64.ts';

/** Onde a chave de cifra fica (IndexedDB, como `CryptoKey` NÃO extraível: o texto da chave nunca existe em JS). */
export interface KeyVault {
  get(): Promise<CryptoKey | null>;
  set(key: CryptoKey): Promise<void>;
}

/** Armazenamento de texto (síncrono, como `localStorage`). */
export interface TextStorage {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export interface EncryptedSession {
  save(plain: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): void;
}

/**
 * Cifra a sessão (tokens) com AES-GCM antes de guardar. Protege contra leitura casual do armazenamento do app
 * (cópias de arquivos, backups); não substitui o isolamento do Android. Falha ao decifrar = sem sessão.
 */
export async function encryptedSession(storage: TextStorage, vault: KeyVault): Promise<EncryptedSession> {
  let key = await vault.get();
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await vault.set(key);
  }
  const k = key;
  return {
    async save(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain)));
      const out = new Uint8Array(iv.length + data.length);
      out.set(iv, 0);
      out.set(data, iv.length);
      storage.write(bytesToBase64(out));
    },
    async load() {
      const stored = storage.read();
      if (!stored) return null;
      try {
        const bytes = base64ToBytes(stored);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, k, bytes.slice(12));
        return new TextDecoder().decode(plain);
      } catch {
        return null;
      }
    },
    clear: () => storage.clear(),
  };
}

/**
 * Ponte para o `SessionStorage` síncrono do login: lê tudo na abertura e grava cifrado em segundo plano.
 * Uma falha de gravação só aparece no console (a sessão continua válida na memória até fechar o app).
 */
export async function syncSessionStorage(secure: EncryptedSession): Promise<TextStorage> {
  let cache = await secure.load();
  return {
    read: () => cache,
    write: (value) => {
      cache = value;
      void secure.save(value).catch((e) => console.error('Não foi possível guardar a sessão cifrada:', e));
    },
    clear: () => {
      cache = null;
      secure.clear();
    },
  };
}

/** Cofre de chave no IndexedDB (a `CryptoKey` não extraível sobrevive ao fechar o app). */
export function indexedDbKeyVault(dbName = 'nimboo-keys'): KeyVault {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('keys');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return {
    async get() {
      const db = await open();
      return new Promise<CryptoKey | null>((resolve, reject) => {
        const req = db.transaction('keys').objectStore('keys').get('session');
        req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').put(key, 'session');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}
