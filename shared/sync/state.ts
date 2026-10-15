/** O que a interface sabe sobre a sincronização (nunca tokens nem chaves). */
export interface SyncState {
  /** Gravação segura disponível (cofre do Windows); sem ela não há login. */
  canStore: boolean;
  /** Conta conectada ou `null`. */
  account: { email: string } | null;
  /** A pessoa ligou a sincronização (consentimento dado). */
  enabled: boolean;
  status: 'off' | 'idle' | 'syncing' | 'error' | 'login';
  lastSync: string | null;
  error: string | null;
  /** Mudanças locais ainda não enviadas. */
  pending: number;
}

export type SyncResultMessage = { ok: true } | { ok: false; message: string };

export const EMPTY_SYNC: SyncState = {
  canStore: true,
  account: null,
  enabled: false,
  status: 'off',
  lastSync: null,
  error: null,
  pending: 0,
};
