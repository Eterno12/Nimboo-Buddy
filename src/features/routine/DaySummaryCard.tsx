import { useRoutine } from './useRoutine';
import './routine.css';

const REASON_LABEL = { overdue: 'atrasada', today: 'hoje', priority: 'prioridade alta' } as const;

/** Cartão do resumo da manhã / fechamento da noite (aparece nas tarefas até ser dispensado). */
export function DaySummaryCard() {
  const { summary, dismiss, ready } = useRoutine();
  if (!summary || !ready) return null;

  return (
    <section className="day-card" data-kind={summary.kind} aria-label={summary.kind === 'morning' ? 'Resumo do dia' : 'Fechamento do dia'}>
      <header className="day-card-head">
        <strong>{summary.greeting}</strong>
        <button type="button" className="day-card-close" onClick={() => void dismiss()} aria-label="Dispensar por hoje" title="Dispensar por hoje">
          ✕
        </button>
      </header>
      <ul className="day-card-lines">
        {summary.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {summary.highlights.length > 0 && (
        <ul className="day-card-highlights" aria-label="Em destaque">
          {summary.highlights.map((h) => (
            <li key={h.id} data-reason={h.reason}>
              <span>{h.title}</span>
              <small>{REASON_LABEL[h.reason]}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
