import { SyncAuthError, type FetchLike } from './supabaseTransport.ts';

export interface SessionStorage {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

export type AuthResult = { ok: true } | { ok: false; message: string };

export interface SupabaseAuthOptions {
  url: string;
  anonKey: string;
  fetch: FetchLike;
  /** Sessão guardada cifrada (cofre do Windows). */
  storage: SessionStorage;
  now?: () => number;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  /** ms desde 1970. */
  expiresAt: number;
  email: string;
  userId: string;
}

/** Renova o token quando faltam menos de 60 s para expirar. */
const REFRESH_MARGIN_MS = 60_000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const CODE_RE = /^\d{6,10}$/;

/**
 * Login por e-mail com código (sem senha) no Supabase Auth. Só fala com o servidor pelo `fetch` injetado
 * (no app, o do processo principal). A sessão é guardada pelo `storage` (cifrado).
 */
export class SupabaseAuth {
  private readonly o: SupabaseAuthOptions;
  private readonly now: () => number;
  private current: Session | null = null;
  private refreshing: Promise<string> | null = null;

  constructor(options: SupabaseAuthOptions) {
    this.o = options;
    this.now = options.now ?? (() => Date.now());
    this.current = this.load();
  }

  private load(): Session | null {
    try {
      const raw = this.o.storage.read();
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<Session>;
      if (
        typeof s.accessToken === 'string' &&
        typeof s.refreshToken === 'string' &&
        typeof s.expiresAt === 'number' &&
        typeof s.email === 'string' &&
        typeof s.userId === 'string'
      ) {
        return s as Session;
      }
    } catch {
      /* arquivo ausente ou corrompido: sem sessão */
    }
    return null;
  }

  private save(s: Session | null): void {
    this.current = s;
    try {
      if (s) this.o.storage.write(JSON.stringify(s));
      else this.o.storage.clear();
    } catch (error) {
      console.error('Não foi possível guardar a sessão:', error);
    }
  }

  /** Conta conectada (sem tokens) ou `null`. */
  account(): { email: string; userId: string } | null {
    return this.current ? { email: this.current.email, userId: this.current.userId } : null;
  }

  private async post(path: string, body: unknown, bearer?: string): Promise<{ status: number; data: Record<string, unknown> }> {
    const res = await this.o.fetch(`${this.o.url}${path}`, {
      method: 'POST',
      headers: { apikey: this.o.anonKey, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    });
    let data: Record<string, unknown> = {};
    try {
      const parsed = await res.json();
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
    } catch {
      /* sem corpo */
    }
    return { status: res.status, data };
  }

  /** Envia o código de 6 dígitos para o e-mail (cria a conta na primeira vez). */
  async requestCode(emailInput: string): Promise<AuthResult> {
    const email = String(emailInput).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, message: 'Esse e-mail não parece válido.' };
    try {
      const r = await this.post('/auth/v1/otp', { email, create_user: true });
      if (r.status === 429) return { ok: false, message: 'Muitas tentativas. Espere um minuto e tente de novo.' };
      if (r.status < 200 || r.status >= 300) return { ok: false, message: 'Não foi possível enviar o código agora.' };
      return { ok: true };
    } catch {
      return { ok: false, message: 'Sem conexão com a internet.' };
    }
  }

  /** Confirma o código recebido por e-mail e abre a sessão. */
  async verifyCode(emailInput: string, codeInput: string): Promise<AuthResult> {
    const email = String(emailInput).trim().toLowerCase();
    const code = String(codeInput).trim();
    if (!EMAIL_RE.test(email)) return { ok: false, message: 'Esse e-mail não parece válido.' };
    if (!CODE_RE.test(code)) return { ok: false, message: 'O código tem só números (6 dígitos).' };
    try {
      const r = await this.post('/auth/v1/verify', { type: 'email', email, token: code });
      if (r.status === 429) return { ok: false, message: 'Muitas tentativas. Espere um minuto e tente de novo.' };
      const session = this.parse(r.data, email);
      if (r.status < 200 || r.status >= 300 || !session) {
        return { ok: false, message: 'Código incorreto ou expirado. Peça um novo código.' };
      }
      this.save(session);
      return { ok: true };
    } catch {
      return { ok: false, message: 'Sem conexão com a internet.' };
    }
  }

  private parse(data: Record<string, unknown>, fallbackEmail: string): Session | null {
    const user = (data.user ?? {}) as Record<string, unknown>;
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof user.id !== 'string') return null;
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: this.now() + expiresIn * 1000,
      email: typeof user.email === 'string' ? user.email : fallbackEmail,
      userId: user.id,
    };
  }

  /** Token válido (renova quando preciso). Sem sessão ou renovação recusada: `SyncAuthError`. */
  async accessToken(): Promise<string> {
    const s = this.current;
    if (!s) throw new SyncAuthError();
    if (s.expiresAt - this.now() > REFRESH_MARGIN_MS) return s.accessToken;
    this.refreshing ??= this.refresh(s).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(s: Session): Promise<string> {
    let r: { status: number; data: Record<string, unknown> };
    try {
      r = await this.post('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refreshToken });
    } catch {
      throw new Error('Sem conexão com a internet.');
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      this.save(null); // o refresh token já não vale: precisa entrar de novo
      throw new SyncAuthError();
    }
    const next = this.parse(r.data, s.email);
    if (r.status < 200 || r.status >= 300 || !next) throw new Error('Não foi possível renovar o login agora.');
    this.save(next);
    return next.accessToken;
  }

  /** Encerra a sessão aqui e (se der) no servidor. Dados locais ficam intactos. */
  async signOut(): Promise<void> {
    const s = this.current;
    this.save(null);
    if (!s) return;
    try {
      await this.post('/auth/v1/logout', {}, s.accessToken);
    } catch {
      /* sem rede: a sessão local já foi apagada */
    }
  }
}
