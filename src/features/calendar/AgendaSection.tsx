import { useEffect, useState } from 'react';
import { eventTimeLabel, todaysAgenda } from '../../../shared/calendar';
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
              </li>
            );
          })}
          {more > 0 && <li className="agenda-more">+ {more} {more === 1 ? 'evento' : 'eventos'}</li>}
        </ul>
      )}
    </section>
  );
}
