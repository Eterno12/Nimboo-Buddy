import { useCallback, useEffect, useState } from 'react';
import type { Task } from '../../shared/tasks';
import type { Core } from './core';

/** Casca funcional (F3): entrar, tarefas e estado da sincronização. A interface final é a F4. */
export function App({ core }: { core: Core }) {
  const [, force] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState<'tasks' | 'account'>('tasks');

  const load = useCallback(async () => {
    setTasks((await core.tasks.list()).active);
  }, [core]);

  useEffect(() => {
    void load();
    return core.subscribe(() => {
      force((n) => n + 1);
      void load();
    });
  }, [core, load]);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    const r = await core.tasks.create(t);
    if (r.ok) setTitle('');
  };

  const state = core.syncState();
  const account = core.auth.account();
  const status = !account
    ? 'Offline (sem conta)'
    : !core.syncEnabled()
      ? 'Sincronização desligada'
      : state.status === 'syncing'
        ? 'Sincronizando…'
        : state.status === 'login'
          ? 'Entre de novo'
          : state.status === 'error'
            ? (state.error ?? 'Erro ao sincronizar')
            : state.lastSync
              ? 'Sincronizado'
              : 'Pronto';

  return (
    <div className="app">
      <header className="top">
        <h1>Nimboo</h1>
        <span className="chip" data-testid="status" data-status={state.status}>
          {status}
        </span>
      </header>

      {core.recovered && (
        <p className="notice" role="status">
          Os dados deste aparelho estavam danificados; vamos baixá-los da nuvem.
        </p>
      )}

      {tab === 'tasks' ? (
        <main>
          <form
            className="add"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nova tarefa" aria-label="Nova tarefa" data-testid="new-task" />
            <button type="submit" data-testid="add-task">
              Adicionar
            </button>
          </form>
          <ul className="tasks" data-testid="tasks">
            {tasks.map((t) => (
              <li key={t.id} data-testid="task">
                <button className="check" aria-label={`Concluir ${t.title}`} onClick={() => void core.tasks.complete(t.id)} />
                <span className="title">{t.title}</span>
                <button className="del" aria-label={`Excluir ${t.title}`} onClick={() => void core.tasks.remove(t.id)}>
                  ×
                </button>
              </li>
            ))}
            {tasks.length === 0 && <li className="empty">Nenhuma tarefa por aqui.</li>}
          </ul>
        </main>
      ) : (
        <Account core={core} />
      )}

      <nav className="tabs">
        <button aria-pressed={tab === 'tasks'} onClick={() => setTab('tasks')} data-testid="tab-tasks">
          Tarefas
        </button>
        <button aria-pressed={tab === 'account'} onClick={() => setTab('account')} data-testid="tab-account">
          Conta
        </button>
      </nav>
    </div>
  );
}

function Account({ core }: { core: Core }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const account = core.auth.account();
  const refresh = () => force((n) => n + 1);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (!account) {
    return (
      <main className="account">
        <p>Entre para sincronizar com o Nimboo do computador. Nada sai do aparelho sem isso.</p>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" aria-label="E-mail" data-testid="email" />
        {sent && <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" aria-label="Código" data-testid="code" />}
        {!sent ? (
          <button
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
        {msg && (
          <p className="msg" role="status" data-testid="msg">
            {msg}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="account">
      <p data-testid="account">
        Conta: <strong>{account.email}</strong>
      </p>
      {!core.syncEnabled() ? (
        <>
          <label className="check-row">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="consent" />
            <span>Entendo que minhas tarefas serão guardadas na nuvem (Supabase), protegidas pela minha conta.</span>
          </label>
          <button disabled={!consent} data-testid="enable" onClick={() => core.setSyncEnabled(true)}>
            Ligar sincronização
          </button>
        </>
      ) : (
        <>
          <button disabled={busy} data-testid="sync-now" onClick={() => void act(() => core.syncNow())}>
            Sincronizar agora
          </button>
          <button disabled={busy} onClick={() => core.setSyncEnabled(false)}>
            Pausar
          </button>
        </>
      )}
      <button disabled={busy} data-testid="sign-out" onClick={() => void act(() => core.auth.signOut())}>
        Sair da conta
      </button>
    </main>
  );
}
