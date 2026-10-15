import { useMemo } from 'react';
import { PRIORITY_LABEL, type Task } from '../../../shared/tasks';
import { formatDue } from '../../../src/features/tasks/dueFormat';
import { Mascot } from '../../../src/features/mascot/Mascot';
import type { useMascot } from '../../../src/features/mascot/useMascot';
import type { Profile } from '../profile';
import { greeting, summarize } from '../today';
import { Icon } from '../ui/Icon';

interface Props {
  profile: Profile;
  mascot: ReturnType<typeof useMascot>;
  tasks: Task[];
  onAdd(): void;
  onOpenTasks(): void;
  onToggle(task: Task): void;
}

/** "Hoje": o mascote, uma frase pelo que há para fazer e as próximas tarefas. */
export function TodayScreen({ profile, mascot, tasks, onAdd, onOpenTasks, onToggle }: Props) {
  const now = new Date();
  const summary = useMemo(() => summarize(tasks, new Date()), [tasks]);
  const hello = greeting(now, summary);

  return (
    <div className="screen" data-testid="screen-today">
      <section className="hero">
        <button type="button" className="hero-mascot" aria-label={`Fazer carinho em ${profile.name}`} onClick={() => mascot.pet()}>
          <Mascot
            state={mascot.state}
            replay={mascot.replay}
            hop={mascot.hop}
            blinking={mascot.blinking}
            mood={mascot.mood}
            character={profile.character}
            palette={profile.color}
            uid="today"
            onHopEnd={mascot.endHop}
          />
        </button>
        <div className="hero-text">
          <h1>{hello.title}</h1>
          <p data-testid="today-line">{hello.line}</p>
        </div>
      </section>

      <section className="stats" aria-label="Resumo">
        <div className="stat" data-tone={summary.overdue > 0 ? 'warn' : undefined}>
          <strong>{summary.overdue}</strong>
          <span>atrasadas</span>
        </div>
        <div className="stat">
          <strong>{summary.today}</strong>
          <span>para hoje</span>
        </div>
        <div className="stat">
          <strong>{summary.total}</strong>
          <span>no total</span>
        </div>
      </section>

      <section aria-labelledby="next-h">
        <div className="section-head">
          <h2 id="next-h">Próximas</h2>
          <button type="button" className="link-btn" onClick={onOpenTasks}>
            Ver todas
          </button>
        </div>
        {summary.next.length === 0 ? (
          <div className="empty-card">
            <p>{summary.total === 0 ? 'Nenhuma tarefa por aqui.' : 'Nenhuma tarefa com prazo.'}</p>
            <button type="button" className="btn-soft" onClick={onAdd}>
              <Icon name="plus" size={18} /> Nova tarefa
            </button>
          </div>
        ) : (
          <ul className="next-list">
            {summary.next.map((t) => (
              <li key={t.id}>
                <button type="button" className="task-check" aria-label={`Concluir ${t.title}`} onClick={() => onToggle(t)}>
                  <Icon name="check" size={18} />
                </button>
                <span className="next-title">{t.title}</span>
                <span className="next-due">
                  {t.priority >= 2 && <span className="chip-prio" data-priority={t.priority}>{PRIORITY_LABEL[t.priority]}</span>}
                  {t.dueAt ? formatDue(t.dueAt, now) : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
