import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { parseAssistantCommand, type AssistantCommand } from '../../../shared/assistant';
import type { AssistantAiAnswer, AssistantAiStatus, AssistantChatTurn } from '../../../shared/assistantApi';
import { buildContext, hideActionFence, parseActions, type ProposedAction } from '../../../shared/persona';
import { eventTimeLabel, todaysAgenda } from '../../../shared/calendar';
import { Mascot } from '../mascot/Mascot';
import type { MascotState } from '../mascot/mascotStates';
import { useSettings } from '../settings/useSettings';
import { useTheme } from '../settings/useTheme';
import { runAssistantCommand } from './assistantActions';
import './assistant.css';

type Role = 'user' | 'assistant';

interface Message {
  id: number;
  role: Role;
  text: string;
  /** Rodapé opcional: fonte de uma resposta de conhecimento. */
  source?: { label: string; url?: string };
  undo?: () => Promise<void>;
  openNoteId?: string;
  /** Botões extras (ativar fontes, baixar modelo, abrir ajustes de voz). */
  buttons?: { id: string; label: string }[];
  /** Veio do histórico guardado (conversas anteriores). */
  fromHistory?: boolean;
  /** A resposta do Gemini ainda está chegando. */
  streaming?: boolean;
  /** Ações propostas pela IA, cada uma aguardando "Aceitar" ou "Ignorar". */
  actions?: ActionItem[];
}

interface ActionItem {
  action: ProposedAction;
  state: 'pending' | 'done' | 'ignored';
  /** Resposta da execução (ou do erro). */
  result?: string;
  undo?: () => Promise<void>;
}

/** Ação proposta → o mesmo comando local que a interface já executa (nada de caminho paralelo). */
function commandOf(a: ProposedAction): AssistantCommand {
  if (a.type === 'task') return { kind: 'task.create', title: a.title, dueAt: a.dueAt, whenLabel: a.whenLabel };
  if (a.type === 'note') return { kind: 'note.create', text: a.text };
  return { kind: 'focus.start', minutes: a.minutes };
}

const actionLabel = (a: ProposedAction): string =>
  a.type === 'task'
    ? `Criar tarefa: ${a.title}${a.whenLabel ? ` (${a.whenLabel})` : ''}`
    : a.type === 'note'
      ? `Criar nota: ${a.text.length > 70 ? `${a.text.slice(0, 69)}…` : a.text}`
      : `Iniciar foco de ${a.minutes} min`;

const SUGGESTIONS = [
  'Crie uma nota escrito comprar pão',
  'Me lembre de ligar para o João amanhã às 15h',
  'Quais são minhas tarefas?',
  'Iniciar foco de 25 minutos',
];

const WELCOME =
  'Oi! Eu anoto, crio tarefas, mostro sua agenda e inicio o foco. Escreva ou use o microfone e aperte enviar.';

let nextId = 1;

/** Janela de conversa com o Nimboo: comandos locais, voz e perguntas (Wikipédia / IA local). */
export function AssistantView() {
  const { settings, update } = useSettings();
  const theme = useTheme(settings.theme);
  const [messages, setMessages] = useState<Message[]>([{ id: nextId++, role: 'assistant', text: WELCOME }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [awaitingNote, setAwaitingNote] = useState(false);
  const [face, setFace] = useState<{ state: MascotState; replay: number }>({ state: 'idle', replay: 0 });
  const [pull, setPull] = useState<{ fraction: number | null; status: string } | null>(null);
  const history = useRef<AssistantChatTurn[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const react = useCallback((state: MascotState, ms = 1600) => {
    setFace((f) => ({ state, replay: f.replay + 1 }));
    if (ms > 0) window.setTimeout(() => setFace((f) => ({ state: 'idle', replay: f.replay + 1 })), ms);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => window.mochi.assistant.onPullProgress((p) => setPull(p)), []);

  // Histórico: as conversas anteriores aparecem no topo e cada mensagem nova é guardada (se ligado).
  const historyOn = useRef(settings.assistantHistory);
  historyOn.current = settings.assistantHistory;
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.mochi.assistant.history
      .list()
      .then((list) => {
        if (!alive || list.length === 0) return;
        const old: Message[] = list.map((e) => ({
          id: nextId++,
          role: e.role,
          text: e.text,
          source: e.source,
          fromHistory: true,
        }));
        setMessages((cur) => [...old, ...cur]);
        // A memória da conversa continua de onde parou (as últimas mensagens guardadas).
        history.current = [
          ...list.slice(-12).map((e) => ({ role: e.role, content: e.text }) as AssistantChatTurn),
          ...history.current,
        ];
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const push = useCallback((m: Omit<Message, 'id'>) => {
    const msg = { ...m, id: nextId++ };
    setMessages((list) => [...list, msg]);
    if (historyOn.current && !m.fromHistory) {
      window.mochi.assistant.history.add([{ role: m.role, text: m.text, source: m.source }]);
    }
    return msg.id;
  }, []);

  /** Apaga a conversa guardada e a que está na tela; o assistente recomeça do zero. */
  const clearHistory = useCallback(async () => {
    await window.mochi.assistant.history.clear();
    history.current = [];
    setConfirmClear(false);
    setMessages([
      { id: nextId++, role: 'assistant', text: WELCOME },
      { id: nextId++, role: 'assistant', text: 'Pronto! Apaguei o histórico da conversa.' },
    ]);
  }, []);

  const answerAsk = useCallback(
    (a: AssistantAiAnswer, status: AssistantAiStatus | null): Omit<Message, 'id' | 'role'> => {
      if (a.ok) {
        return {
          text: a.text,
          source: {
            label: a.source === 'wikipedia' ? `Wikipédia${a.title ? `: ${a.title}` : ''}` : `IA local (${status?.model ?? 'Ollama'})`,
            url: a.url,
          },
        };
      }
      if (a.code === 'disabled') {
        return {
          text: `${a.message}\n\nA Wikipédia usa a internet (só o texto da sua pergunta é enviado). A IA local roda no seu computador, sem tokens.`,
          buttons: [
            { id: 'enable-web', label: 'Ativar pesquisa na Wikipédia' },
            { id: 'enable-local', label: 'Usar IA local (Ollama)' },
          ],
        };
      }
      if (a.code === 'ollama_missing') {
        return {
          text:
            `${a.message}\n\nPara ter uma IA grátis e privada: instale o Ollama (ollama.com), abra-o e volte aqui para baixar o modelo.`,
          buttons: [{ id: 'enable-web', label: 'Usar só a Wikipédia por enquanto' }],
        };
      }
      if (a.code === 'model_missing') {
        return {
          text: `${a.message} Posso pedir ao Ollama para baixar (alguns GB, só uma vez).`,
          buttons: [{ id: 'pull', label: `Baixar ${status?.model ?? 'o modelo'}` }],
        };
      }
      return { text: a.message };
    },
    [],
  );

  // ---- Gemini: conversa com streaming, identidade do personagem e ações propostas ----
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const chatSeq = useRef(0);
  const activeChat = useRef<{ requestId: number; messageId: number; raw: string } | null>(null);

  useEffect(
    () =>
      window.mochi.assistant.gemini.onChatDelta((requestId, delta) => {
        const a = activeChat.current;
        if (!a || a.requestId !== requestId) return;
        a.raw += delta;
        const shown = hideActionFence(a.raw);
        setMessages((list) => list.map((m) => (m.id === a.messageId ? { ...m, text: shown } : m)));
      }),
    [],
  );

  const askGemini = useCallback(
    async (question: string) => {
      const s = settingsRef.current;
      let context: string | null = null;
      if (s.assistantContext) {
        try {
          const [tasks, cal] = await Promise.all([window.mochi.tasks.list(), window.mochi.calendar.get()]);
          const now = new Date();
          context = buildContext({
            now,
            tasks: tasks.ok ? tasks.value.active.map((t) => ({ title: t.title, dueAt: t.dueAt })) : [],
            events: cal.configured
              ? todaysAgenda(cal.events, now).map((e) => ({ time: eventTimeLabel(e), title: e.title }))
              : [],
          });
        } catch {
          context = null;
        }
      }
      const requestId = ++chatSeq.current;
      const messageId = nextId++;
      activeChat.current = { requestId, messageId, raw: '' };
      setMessages((list) => [...list, { id: messageId, role: 'assistant', text: '', streaming: true }]);
      const turns = history.current
        .slice(-13)
        .map((t) => ({ role: t.role === 'user' ? ('user' as const) : ('model' as const), text: t.content }));
      if (turns.length === 0 || turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', text: question });
      const r = await window.mochi.assistant.gemini.chat(requestId, { turns, context });
      activeChat.current = null;
      if (r.ok) {
        // O main trocou de modelo porque o configurado não existe para essa chave: guarda a escolha.
        if (r.model && r.model !== s.geminiModel) void update({ geminiModel: r.model });
        const parsed = parseActions(r.text);
        const text = parsed.text || 'Pronto!';
        setMessages((list) =>
          list.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  text,
                  streaming: false,
                  source: { label: `Gemini (${r.model ?? s.geminiModel})` },
                  actions: parsed.actions.map((action) => ({ action, state: 'pending' as const })),
                }
              : m,
          ),
        );
        history.current.push({ role: 'assistant', content: text });
        if (historyOn.current) window.mochi.assistant.history.add([{ role: 'assistant', text }]);
        react('happy');
        return;
      }
      const noKey = r.code === 'no_key' || r.code === 'invalid_key';
      const partial = r.code === 'canceled' && r.partial ? hideActionFence(r.partial) : '';
      const text = r.code === 'canceled' ? (partial ? `${partial}\n(Parei por aqui.)` : 'Tudo bem, parei.') : r.message;
      setMessages((list) =>
        list.map((m) =>
          m.id === messageId
            ? {
                ...m,
                text,
                streaming: false,
                buttons: noKey || r.code === 'disabled' || r.code === 'model' ? [{ id: 'open-settings', label: 'Abrir configurações' }] : undefined,
              }
            : m,
        ),
      );
      react('idle');
    },
    [react, update],
  );

  const stopChat = () => {
    const a = activeChat.current;
    if (a) window.mochi.assistant.gemini.cancelChat(a.requestId);
  };

  /** Executa uma ação proposta pela IA com as mesmas APIs dos comandos locais. */
  const runAction = async (messageId: number, index: number) => {
    const msg = messages.find((m) => m.id === messageId);
    const item = msg?.actions?.[index];
    if (!item || item.state !== 'pending') return;
    const patch = (next: Partial<ActionItem>) =>
      setMessages((list) =>
        list.map((m) =>
          m.id === messageId && m.actions
            ? { ...m, actions: m.actions.map((a, i) => (i === index ? { ...a, ...next } : a)) }
            : m,
        ),
      );
    patch({ state: 'done', result: '…' });
    try {
      const reply = await runAssistantCommand(commandOf(item.action));
      window.mochi.bond.event('assistant');
      patch({ state: 'done', result: reply.text, undo: reply.undo });
    } catch {
      patch({ state: 'pending', result: 'Não consegui fazer isso agora.' });
    }
  };

  const ignoreAction = (messageId: number, index: number) =>
    setMessages((list) =>
      list.map((m) =>
        m.id === messageId && m.actions
          ? { ...m, actions: m.actions.map((a, i) => (i === index && a.state === 'pending' ? { ...a, state: 'ignored' as const } : a)) }
          : m,
      ),
    );

  const acceptAll = async (messageId: number) => {
    const msg = messages.find((m) => m.id === messageId);
    const total = msg?.actions?.length ?? 0;
    for (let i = 0; i < total; i++) await runAction(messageId, i);
  };

  const undoAction = async (messageId: number, index: number) => {
    const item = messages.find((m) => m.id === messageId)?.actions?.[index];
    if (!item?.undo) return;
    await item.undo();
    setMessages((list) =>
      list.map((m) =>
        m.id === messageId && m.actions
          ? { ...m, actions: m.actions.map((a, i) => (i === index ? { ...a, undo: undefined, result: `${a.result ?? ''}\n(Desfeito.)` } : a)) }
          : m,
      ),
    );
  };

  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || busy) return;
      setInput('');
      push({ role: 'user', text });
      history.current.push({ role: 'user', content: text });
      setBusy(true);
      react('curious', 0);
      try {
        let command = parseAssistantCommand(text);
        if (awaitingNote) {
          setAwaitingNote(false);
          // Se a pessoa disse um comando em vez do texto, obedece o comando.
          if (command.kind === 'ask' || command.kind === 'greeting') command = { kind: 'note.create', text };
        }
        if (command.kind === 'history.clear') {
          await clearHistory();
          return;
        }
        if (command.kind === 'ask' && settingsRef.current.assistantGemini) {
          await askGemini(text);
        } else if (command.kind === 'ask') {
          const [answer, status] = await Promise.all([
            window.mochi.assistant.ask(text, history.current.slice(0, -1)),
            window.mochi.assistant.status(),
          ]);
          const built = answerAsk(answer, status);
          push({ role: 'assistant', ...built });
          history.current.push({ role: 'assistant', content: built.text });
          react(answer.ok ? 'happy' : 'idle');
        } else {
          const reply = await runAssistantCommand(command);
          if (command.kind !== 'greeting') window.mochi.bond.event('assistant');
          if (reply.awaitNote) setAwaitingNote(true);
          push({ role: 'assistant', text: reply.text, undo: reply.undo, openNoteId: reply.openNoteId });
          history.current.push({ role: 'assistant', content: reply.text });
          react(reply.happy ? 'celebrate' : 'idle', reply.happy ? 2400 : 0);
        }
      } catch (error) {
        console.error('Falha no assistente:', error);
        push({ role: 'assistant', text: 'Algo deu errado por aqui. Tente de novo?' });
        react('annoyed');
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [input, busy, awaitingNote, push, react, answerAsk, clearHistory, askGemini],
  );

  const toggleListen = async () => {
    if (listening) {
      window.mochi.assistant.cancelListen();
      return;
    }
    setListening(true);
    react('curious', 0);
    const r = await window.mochi.assistant.listen();
    setListening(false);
    react('idle', 0);
    if (r.ok) {
      window.mochi.bond.event('voice');
      setInput((current) => (current.trim() ? `${current.trim()} ${r.text}` : r.text));
      inputRef.current?.focus();
    } else if (r.code !== 'canceled') {
      push({
        role: 'assistant',
        text: r.message,
        buttons: r.code === 'privacy' ? [{ id: 'speech-settings', label: 'Abrir configurações de fala do Windows' }] : undefined,
      });
    }
  };

  // Atalho global: a janela abre (ou já está aberta) e começa a ouvir.
  const listenRef = useRef<() => void>(() => undefined);
  listenRef.current = () => {
    if (!listening) void toggleListen();
  };
  useEffect(() => {
    let alive = true;
    void window.mochi.assistant
      .takePendingListen()
      .then((pending) => {
        if (alive && pending) window.setTimeout(() => listenRef.current(), 400);
      })
      .catch(() => undefined);
    const off = window.mochi.assistant.onStartListen(() => listenRef.current());
    return () => {
      alive = false;
      off();
    };
  }, []);

  const onButton = async (id: string) => {
    if (id === 'enable-web') {
      await update({ assistantWeb: true });
      push({ role: 'assistant', text: 'Pronto! Vou pesquisar na Wikipédia quando você perguntar algo. Pode perguntar de novo.' });
    } else if (id === 'enable-local') {
      await update({ assistantLocalAi: true });
      const status = await window.mochi.assistant.status();
      push({
        role: 'assistant',
        text: status.ollamaRunning
          ? status.models.length > 0
            ? 'IA local ligada! Pode perguntar.'
            : `IA local ligada, mas falta baixar o modelo ${status.model}.`
          : 'IA local ligada. Instale e abra o Ollama (ollama.com) para eu conseguir conversar.',
        buttons: status.ollamaRunning && status.models.length === 0 ? [{ id: 'pull', label: `Baixar ${status.model}` }] : undefined,
      });
    } else if (id === 'pull') {
      setPull({ fraction: null, status: 'iniciando' });
      const r = await window.mochi.assistant.pullModel();
      setPull(null);
      push({ role: 'assistant', text: r.message });
    } else if (id === 'open-settings') {
      window.mochi.openSettings();
    } else if (id === 'speech-settings') {
      window.mochi.assistant.openSpeechSettings();
    }
  };

  const undo = async (m: Message) => {
    if (!m.undo) return;
    await m.undo();
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, undo: undefined, text: `${x.text}\n(Desfeito.)` } : x)));
  };

  return (
    <div className="assistant" data-theme={theme}>
      <header className="assistant-head">
        <div className="assistant-face" aria-hidden="true">
          <Mascot
            state={face.state}
            replay={face.replay}
            hop={false}
            blinking={false}
            mood="mid"
            character={settings.character}
            palette={settings.color} skin={settings.skin}
            uid="assist"
          />
        </div>
        <div className="assistant-head-text">
          <h1>{settings.mascotName}</h1>
          <p>{listening ? 'Ouvindo… fale agora' : busy ? 'Pensando…' : 'Pergunte ou peça algo'}</p>
        </div>
        <div className="assistant-head-actions">
          {confirmClear ? (
            <>
              <span>Apagar a conversa guardada?</span>
              <button type="button" className="assistant-danger" data-testid="history-confirm" onClick={() => void clearHistory()}>
                Apagar
              </button>
              <button type="button" onClick={() => setConfirmClear(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <button type="button" data-testid="history-clear" onClick={() => setConfirmClear(true)}>
              Apagar histórico
            </button>
          )}
        </div>
      </header>

      <div className="assistant-list" ref={listRef} role="log" aria-live="polite" aria-label="Conversa">
        {messages.map((m, i) => (
          <Fragment key={m.id}>
          {!m.fromHistory && i > 0 && messages[i - 1].fromHistory && (
            <p className="assistant-divider" role="separator">
              Conversa de agora
            </p>
          )}
          <div className="assistant-msg" data-role={m.role} data-history={m.fromHistory ? 'true' : undefined}>
            <p>{m.streaming && m.text === '' ? '…' : m.text}</p>
            {m.streaming && (
              <div className="assistant-actions">
                <button type="button" data-testid="chat-stop" onClick={stopChat}>
                  Parar
                </button>
              </div>
            )}
            {m.actions && m.actions.length > 0 && (
              <div className="assistant-proposals" data-testid="proposals">
                <p className="assistant-proposals-title">Posso fazer isto por você:</p>
                {m.actions.map((a, i) => (
                  <div key={i} className="assistant-proposal" data-state={a.state}>
                    <span>{actionLabel(a.action)}</span>
                    {a.state === 'pending' && (
                      <span className="assistant-proposal-buttons">
                        <button type="button" className="assistant-primary" data-testid="action-accept" onClick={() => void runAction(m.id, i)}>
                          Aceitar
                        </button>
                        <button type="button" data-testid="action-ignore" onClick={() => ignoreAction(m.id, i)}>
                          Ignorar
                        </button>
                      </span>
                    )}
                    {a.state === 'ignored' && <small>Ignorada</small>}
                    {a.state === 'done' && a.result && (
                      <small>
                        {a.result}
                        {a.undo && (
                          <>
                            {' '}
                            <button type="button" className="assistant-link" onClick={() => void undoAction(m.id, i)}>
                              Desfazer
                            </button>
                          </>
                        )}
                      </small>
                    )}
                  </div>
                ))}
                {m.actions.filter((a) => a.state === 'pending').length >= 2 && (
                  <button type="button" className="assistant-primary" data-testid="action-accept-all" onClick={() => void acceptAll(m.id)}>
                    Aceitar tudo
                  </button>
                )}
              </div>
            )}
            {m.source && (
              <p className="assistant-source">
                Fonte: {m.source.label}
                {m.source.url && (
                  <>
                    {' · '}
                    <a href={m.source.url} target="_blank" rel="noopener noreferrer">
                      abrir
                    </a>
                  </>
                )}
              </p>
            )}
            {(m.undo || m.openNoteId || m.buttons) && (
              <div className="assistant-actions">
                {m.openNoteId && (
                  <button type="button" onClick={() => window.mochi.notes.openManager(m.openNoteId)}>
                    Abrir nota
                  </button>
                )}
                {m.undo && (
                  <button type="button" onClick={() => void undo(m)}>
                    Desfazer
                  </button>
                )}
                {m.buttons?.map((b) => (
                  <button key={b.id} type="button" className="assistant-primary" onClick={() => void onButton(b.id)}>
                    {b.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          </Fragment>
        ))}
        {busy && !messages.some((m) => m.streaming) && (
          <div className="assistant-msg" data-role="assistant" aria-hidden="true">
            <p className="assistant-typing">…</p>
          </div>
        )}
        {pull && (
          <div className="assistant-msg" data-role="assistant">
            <p>
              Baixando o modelo… {pull.fraction !== null ? `${Math.round(pull.fraction * 100)}%` : pull.status}
            </p>
            <progress max={1} value={pull.fraction ?? undefined} />
          </div>
        )}
        {messages.filter((m) => !m.fromHistory).length === 1 && (
          <div className="assistant-suggest" aria-label="Sugestões">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className="assistant-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <button
          type="button"
          className="assistant-mic"
          aria-pressed={listening}
          aria-label={listening ? 'Parar de ouvir' : 'Falar (microfone)'}
          title={listening ? 'Parar de ouvir' : 'Falar (microfone)'}
          onClick={() => void toggleListen()}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path
              d="M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zM6 11.500a6 6 0 0 0 12 0M12 18v3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <textarea
          ref={inputRef}
          value={input}
          rows={2}
          placeholder={awaitingNote ? 'Escreva o texto da nota…' : 'Escreva um pedido ou uma pergunta…'}
          aria-label="Mensagem para o assistente"
          maxLength={1000}
          autoFocus
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="assistant-send" disabled={busy || input.trim() === ''}>
          Enviar
        </button>
      </form>
    </div>
  );
}
