import { useState } from 'react';
import type { Core } from '../core';
import { hasNativeScanner, scanQrNative } from '../platform/nativeScan';
import { QrScanner } from '../ui/QrScanner';

/** Conta e sincronização (entrar por código, consentir, sincronizar, sair). */
export function AccountPanel({ core }: { core: Core }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [, force] = useState(0);
  const account = core.auth.account();
  const state = core.syncState();

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      force((n) => n + 1);
    }
  };

  if (!account) {
    return (
      <section className="card" aria-labelledby="acc-h">
        <h2 id="acc-h">Conta e sincronização</h2>
        <p className="muted">Entre para ter as mesmas tarefas no computador e no celular. Nada sai do aparelho sem isso.</p>
        <label className="field">
          <span>E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" autoComplete="email" data-testid="email" />
        </label>
        {sent && (
          <label className="field">
            <span>Código recebido por e-mail</span>
            <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" autoComplete="one-time-code" data-testid="code" />
          </label>
        )}
        {!sent ? (
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !email}
            data-testid="send-code"
            onClick={() =>
              void act(async () => {
                const r = await core.auth.requestCode(email);
                setMsg(r.ok ? 'Enviamos um código para o seu e-mail.' : r.message);
                if (r.ok) setSent(true);
              })
            }
          >
            Enviar código
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !code}
            data-testid="enter"
            onClick={() =>
              void act(async () => {
                const r = await core.auth.verifyCode(email, code);
                setMsg(r.ok ? null : r.message);
                if (r.ok) setSent(false);
              })
            }
          >
            Entrar
          </button>
        )}
        <button type="button" className="btn-soft" disabled={busy} data-testid="scan-qr" onClick={() => {
            if (!hasNativeScanner()) return setScanning(true);
            void act(async () => {
              const scan = await scanQrNative();
              if (!scan.ok) return setMsg(scan.message || null);
              const r = await core.auth.signInWithPairing(scan.text);
              setMsg(r.ok ? null : r.message);
            });
          }}>
          Escanear QR do PC (sem e-mail)
        </button>
        {msg && (
          <p className="muted" role="status" data-testid="msg">
            {msg}
          </p>
        )}
        {scanning && (
          <QrScanner
            onClose={() => setScanning(false)}
            onResult={(text) =>
              void act(async () => {
                const r = await core.auth.signInWithPairing(text);
                setMsg(r.ok ? null : r.message);
                if (r.ok) setScanning(false);
              })
            }
          />
        )}
      </section>
    );
  }

  return (
    <section className="card" aria-labelledby="acc-h">
      <h2 id="acc-h">Conta e sincronização</h2>
      <p data-testid="account">
        Conta: <strong>{account.email}</strong>
      </p>
      {!core.syncEnabled() ? (
        <>
          <label className="check-row">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="consent" />
            <span>Entendo que minhas tarefas serão guardadas na nuvem (Supabase), protegidas pela minha conta.</span>
          </label>
          <button type="button" className="btn-primary" disabled={!consent} data-testid="enable" onClick={() => core.setSyncEnabled(true)}>
            Ligar sincronização
          </button>
        </>
      ) : (
        <>
          <p className="muted" role="status" data-testid="sync-text">
            {state.status === 'syncing'
              ? 'Sincronizando…'
              : state.status === 'error'
                ? (state.error ?? 'Erro ao sincronizar')
                : state.status === 'login'
                  ? 'Entre de novo para continuar.'
                  : state.lastSync
                    ? `Última sincronização: ${new Date(state.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Pronto para sincronizar.'}
          </p>
          <div className="row">
            <button type="button" className="btn-primary" disabled={busy} data-testid="sync-now" onClick={() => void act(() => core.syncNow())}>
              Sincronizar agora
            </button>
            <button type="button" className="btn-soft" disabled={busy} onClick={() => core.setSyncEnabled(false)}>
              Pausar
            </button>
          </div>
        </>
      )}
      <button type="button" className="btn-soft" disabled={busy} data-testid="sign-out" onClick={() => void act(() => core.auth.signOut())}>
        Sair da conta
      </button>
    </section>
  );
}
