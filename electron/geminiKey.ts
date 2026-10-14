import fs from 'node:fs';
import path from 'node:path';

/** Chave de API colada pela pessoa: 20 a 100 caracteres de letras, números, `_` e `-`. */
export const GEMINI_KEY_RE = /^[A-Za-z0-9_-]{20,100}$/;

export interface KeyCrypto {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

export type KeyResult = { ok: true } | { ok: false; message: string };

/**
 * Guarda a chave do Gemini cifrada pelo Windows (DPAPI, via `safeStorage`) em `gemini.key` dentro da pasta de
 * dados. Sem cifra disponível, RECUSA guardar (nunca grava em texto simples). A chave nunca é devolvida à
 * interface: só o main a lê, na hora de chamar a API.
 */
export class GeminiKeyStore {
  private readonly file: string;
  private readonly crypto: KeyCrypto;

  constructor(dir: string, crypto: KeyCrypto) {
    this.file = path.join(dir, 'gemini.key');
    this.crypto = crypto;
  }

  encryptionAvailable(): boolean {
    try {
      return this.crypto.isAvailable();
    } catch {
      return false;
    }
  }

  has(): boolean {
    return this.get() !== null;
  }

  get(): string | null {
    try {
      if (!fs.existsSync(this.file) || !this.encryptionAvailable()) return null;
      const key = this.crypto.decrypt(fs.readFileSync(this.file));
      return GEMINI_KEY_RE.test(key) ? key : null;
    } catch {
      return null;
    }
  }

  set(raw: unknown): KeyResult {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!GEMINI_KEY_RE.test(key)) {
      return { ok: false, message: 'Essa chave não parece válida. Copie a chave inteira, sem espaços.' };
    }
    if (!this.encryptionAvailable()) {
      return { ok: false, message: 'Este computador não permite guardar a chave com segurança, então não vou guardá-la.' };
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, this.crypto.encrypt(key));
      fs.renameSync(tmp, this.file);
      return { ok: true };
    } catch {
      return { ok: false, message: 'Não consegui guardar a chave.' };
    }
  }

  clear(): void {
    try {
      fs.rmSync(this.file, { force: true });
    } catch {
      /* já não existe */
    }
  }
}
