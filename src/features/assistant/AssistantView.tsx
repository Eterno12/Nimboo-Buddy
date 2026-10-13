import { useCallback, useEffect, useRef, useState } from 'react';
import { parseAssistantCommand } from '../../../shared/assistant';
import type { AssistantAiAnswer, AssistantAiStatus, AssistantChatTurn } from '../../../shared/assistantApi';
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
}

const SUGGESTIONS = [
  'Crie uma nota escrito comprar pão',
  'Me lembre de ligar para o João amanhã às 15h',
  'Quais são minhas tarefas?',
  'Iniciar foco de 25 minutos',
];

const WELCOME =
  'Oi! Eu anoto, crio tarefas, mostro sua agenda e inicio o foco. Escreva ou use o microfone e aperte enviar.';

let nextId = 1;

/** Janela de conversa com o Mochi: comandos locais, voz e perguntas (Wikipédia / IA local). */
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

  const push = useCallback((m: Omit<Message, 'id'>) => {
    const msg = { ...m, id: nextId++ };
    setMessages((list) => [...list, msg]);
    return msg.id;
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
        if (command.kind === 'ask') {
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
    [input, busy, awaitingNote, push, react, answerAsk],
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
            palette={settings.color}
            uid="assist"
          />
        </div>
        <div>
          <h1>Assistente</h1>
          <p>{listening ? 'Ouvindo… fale agora' : busy ? 'Pensando…' : 'Pergunte ou peça algo'}</p>
        </div>
      </header>

      <div className="assistant-list" ref={listRef} role="log" aria-live="polite" aria-label="Conversa">
        {messages.map((m) => (
          <div key={m.id} className="assistant-msg" data-role={m.role}>
            <p>{m.text}</p>
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
        ))}
        {busy && (
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
        {messages.length === 1 && (
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
