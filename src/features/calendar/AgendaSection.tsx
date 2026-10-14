import { useEffect, useState } from 'react';
import { canBecomeTask, eventTimeLabel, taskFromEvent, todaysAgenda, type CalendarEvent } from '../../../shared/calendar';
import { useTasks } from '../tasks/useTasks';
import { openLinkedNote, useNoteLinks } from '../notes/useNoteLinks';
import { useCalendar } from './useCalendar';
import './calendar.css';

const STORAGE_KEY = 'mochi.agenda.collapsed';

const readCollapsed = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

interface AgendaSectionProps {
  /** Na ilha cabe menos: poucas linhas. */
  variant: 'island' | 'panel';
}

/**
 * "Agenda de hoje": os eventos do dia vindos do endereço iCal (somente leitura). Sem agenda conectada
 * mostra só um convite discreto (no painel); na ilha não ocupa espaço.
 */
export function AgendaSection({ variant }: AgendaSectionProps) {
  const { state } = useCalendar();
  const tasks = useTasks();
  const noteLinks = useNoteLinks();
  /** Eventos que já viraram tarefa (ativa ou concluída ainda guardada), por id do evento. */
  const linked = new Set([...tasks.active, ...tasks.completed].flatMap((t) => (t.sourceRef ? [t.sourceRef] : [])));
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Reavalia "já passou" a cada minuto sem recarregar nada.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!state.configured) {
    if (variant === 'island') return null;
    return (
      <button type="button" className="agenda-connect" onClick={() => window.mochi.openSettings()}>
        Conectar o Google Agenda
      </button>
    );
  }

  const today = todaysAgenda(state.events, now);
  const limit = variant === 'island' ? 3 : 5;
  const shown = collapsed ? [] : today.slice(0, limit);
  const more = today.length - shown.length;

  /** O evento do Google vira uma tarefa do app (título e, se ainda for futuro, o horário como prazo). */
  const makeTask = async (event: CalendarEvent) => {
    if (busy) return;
    const data = taskFromEvent(event, new Date());
    setBusy(event.id);
    setProblem(null);
    const result = await tasks.create(data.title, data.dueAt, data.sourceRef);
    setBusy(null);
    if (!result.ok) setProblem(result.error.message);
  };

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* sem armazenamento: só não lembra */
    }
  };

  return (
    <section className="agenda" aria-label="Agenda de hoje">
      <button type="button" className="agenda-head" aria-expanded={!collapsed} onClick={toggle}>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" data-open={!collapsed}>
          <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Agenda de hoje</span>
        <span className="agenda-count">{today.length}</span>
        {state.error && (
          <span className="agenda-warn" title={state.error} role="img" aria-label={`Aviso: ${state.error}`}>
            !
          </span>
        )}
      </button>
      {!collapsed && (
        <ul className="agenda-list">
          {today.length === 0 && <li className="agenda-empty">Nada na agenda hoje.</li>}
          {shown.map((event) => {
            const past = !event.allDay && Date.parse(event.end) <= now.getTime();
            return (
              <li key={event.id} className="agenda-item" data-past={past} title={event.location ?? undefined}>
                <span className="agenda-time">{eventTimeLabel(event)}</span>
                <span className="agenda-title">{event.title}</span>
                <button
                  type="button"
                  className="agenda-agenda-note"
                  data-has={noteLinks.byEvent.has(event.id)}
                  aria-label={
                    noteLinks.byEvent.has(event.id) ? `Abrir a pauta do evento: ${event.title}` : `Criar a pauta do evento: ${event.title}`
                  }
                  title={noteLinks.byEvent.has(event.id) ? 'Abrir a pauta (nota do evento)' : 'Pauta: cria uma nota para este evento'}
                  onClick={async () => {
                    const message = await openLinkedNote({ eventRef: event.id }, event.title, `${eventTimeLabel(event)}${event.location ? ` · ${event.location}` : ''}`);
                    setProblem(message ? `Não foi possível abrir a pauta. ${message}` : null);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false">
                    <path d="M6 4h8.5L18 7.500V20H6zM9 11h6M9 15h4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {linked.has(event.id) ? (
                  <span className="agenda-linked" role="img" aria-label="Já é uma tarefa">
                    ✓ Tarefa
                  </span>
                ) : (
                  canBecomeTask(event, now) && (
                    <button
                      type="button"
                      className="agenda-make-task"
                      aria-label={`Virar tarefa: ${event.title}`}
                      title="Transforma este evento em uma tarefa na sua lista"
                      disabled={busy === event.id}
                      onClick={() => void makeTask(event)}
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
                        <path d="M5 12h12M12 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Virar tarefa
                    </button>
                  )
                )}
              </li>
            );
          })}
          {problem && (
            <li className="agenda-problem" role="alert">
              {problem}
            </li>
          )}
          {more > 0 && <li className="agenda-more">+ {more} {more === 1 ? 'evento' : 'eventos'}</li>}
        </ul>
      )}
    </section>
  );
}
