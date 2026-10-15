import { useState } from 'react';
import { PairingPanel } from './PairingPanel';
import { useSync } from './useSync';

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface Props {
  hidden: boolean;
  enabled: boolean;
  onEnabledChange(enabled: boolean): void;
}

/** Conta e sincronização (opt-in): entrar com código por e-mail, consentir, sincronizar, sair, apagar da nuvem. */
export function SyncSettings({ hidden, enabled, onEnabledChange }: Props) {
  const { state, busy, requestCode, verify, syncNow, signOut, wipeCloud } = useSync();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

  const sendCode = async () => {
    setMessage(null);
    const r = await requestCode(email);
    if (r.ok) {
      setCodeSent(true);
      setMessage({ text: 'Enviamos um código para o seu e-mail. Digite-o abaixo.', tone: 'ok' });
    } else setMessage({ text: r.message, tone: 'warn' });
  };

  const enter = async () => {
    setMessage(null);
    const r = await verify(email, code);
    if (r.ok) {
      setCode('');
      setCodeSent(false);
    } else setMessage({ text: r.message, tone: 'warn' });
  };

  const wipe = async () => {
    setConfirmWipe(false);
    const r = await wipeCloud();
    if (r.ok) {
      onEnabledChange(false); // senão a próxima rodada enviaria tudo de novo
      setConsent(false);
      setMessage({ text: 'Seus dados foram apagados da nuvem e a sincronização foi desligada. O que está neste computador continua aqui.', tone: 'ok' });
    } else setMessage({ text: r.message, tone: 'warn' });
  };

  const status = !state.account
    ? null
    : !enabled
      ? 'Sincronização desligada.'
      : state.status === 'syncing'
        ? 'Sincronizando…'
        : state.status === 'login'
          ? 'Entre de novo para continuar sincronizando.'
          : state.status === 'error'
            ? (state.error ?? 'Não foi possível sincronizar agora.')
            : state.lastSync
              ? `Sincronizado às ${time.format(new Date(state.lastSync))}${state.pending > 0 ? ` · ${state.pending} mudança(s) para enviar` : ''}.`
              : 'Pronto para sincronizar.';

  return (
    <fieldset className="settings-group" hidden={hidden} data-testid="sync-group">
      <legend>Conta e sincronização</legend>
      <p className="settings-hint">
        Opcional. Entre na sua conta para ter tarefas, notas e sessões de foco iguais em outros aparelhos. Nada sai deste computador sem isso. A chave do
        Gemini e os endereços de agenda nunca são enviados.
      </p>

      {!state.account ? (
        <>
          <label className="settings-stack">
            <span>E-mail</span>
            <input
              type="email"
              className="settings-text"
              value={email}
              placeholder="voce@exemplo.com"
              autoComplete="email"
              disabled={!state.canStore || busy}
              data-testid="sync-email"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {codeSent && (
            <label className="settings-stack">
              <span>Código recebido por e-mail</span>
              <input
                type="text"
                inputMode="numeric"
                className="settings-text"
                value={code}
                placeholder="000000"
                autoComplete="one-time-code"
                disabled={busy}
                data-testid="sync-code"
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.trim() !== '') void enter();
                }}
              />
            </label>
          )}
          <div className="settings-inline">
            {!codeSent ? (
              <button type="button" className="settings-small" disabled={!state.canStore || busy || email.trim() === ''} data-testid="sync-send" onClick={() => void sendCode()}>
                {busy ? 'Enviando…' : 'Enviar código'}
              </button>
            ) : (
              <>
                <button type="button" className="settings-small" disabled={busy || code.trim() === ''} data-testid="sync-enter" onClick={() => void enter()}>
                  {busy ? 'Entrando…' : 'Entrar'}
                </button>
                <button type="button" className="settings-small" disabled={busy} onClick={() => void sendCode()}>
                  Reenviar código
                </button>
              </>
            )}
          </div>
          {!state.canStore && (
            <p className="settings-hint" data-tone="warn">
              O cofre de senhas do Windows não está disponível, então não dá para guardar o login com segurança.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="settings-hint" data-testid="sync-account">
            Conta: <strong>{state.account.email}</strong>
          </p>
          {!enabled && (
            <label className="settings-check">
              <input type="checkbox" checked={consent} data-testid="sync-consent" onChange={(e) => setConsent(e.target.checked)} />
              <span>
                Entendo que minhas tarefas, notas e sessões de foco serão guardadas na nuvem (Supabase), protegidas pela minha conta.
              </span>
            </label>
          )}
          <div className="settings-inline">
            {!enabled ? (
              <button type="button" className="settings-small" disabled={!consent || busy} data-testid="sync-enable" onClick={() => onEnabledChange(true)}>
                Ligar sincronização
              </button>
            ) : (
              <>
                <button type="button" className="settings-small" disabled={busy || state.status === 'syncing'} data-testid="sync-now" onClick={() => void syncNow()}>
                  Sincronizar agora
                </button>
                <button type="button" className="settings-small" disabled={busy} data-testid="sync-disable" onClick={() => onEnabledChange(false)}>
                  Pausar
                </button>
              </>
            )}
            <button type="button" className="settings-small" disabled={busy} data-testid="sync-signout" onClick={() => void signOut()}>
              Sair da conta
            </button>
          </div>
          {status && (
            <p className="settings-hint" role="status" data-testid="sync-status" data-tone={state.status === 'error' || state.status === 'login' ? 'warn' : 'ok'}>
              {status}
            </p>
          )}
          <PairingPanel />
          <details className="settings-help">
            <summary>Apagar meus dados da nuvem</summary>
            <p>
              Remove da nuvem tudo que foi enviado. As tarefas e notas deste computador continuam aqui, e a sincronização é desligada.
            </p>
            {!confirmWipe ? (
              <button type="button" className="settings-small" disabled={busy} data-testid="sync-wipe" onClick={() => setConfirmWipe(true)}>
                Apagar da nuvem…
              </button>
            ) : (
              <div className="settings-inline">
                <button type="button" className="settings-small" disabled={busy} data-testid="sync-wipe-confirm" onClick={() => void wipe()}>
                  Confirmar: apagar da nuvem
                </button>
                <button type="button" className="settings-small" onClick={() => setConfirmWipe(false)}>
                  Cancelar
                </button>
              </div>
            )}
          </details>
        </>
      )}

      {message && (
        <p className="settings-hint" role="status" data-tone={message.tone} data-testid="sync-message">
          {message.text}
        </p>
      )}
    </fieldset>
  );
}
