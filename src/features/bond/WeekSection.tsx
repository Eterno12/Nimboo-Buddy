import { useEffect, useState } from 'react';
import { formatMinutes, type WeekStats } from '../../../shared/stats';

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const weekdayOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAY[new Date(y, m - 1, d).getDay()];
};

/** "Sua semana": foco por dia (barras), tarefas concluídas e a sequência atual. */
export function WeekSection({ streak, refreshKey }: { streak: number; refreshKey: number }) {
  const [week, setWeek] = useState<WeekStats | null>(null);

  useEffect(() => {
    let alive = true;
    void window.mochi.bond
      .week()
      .then((w) => alive && setWeek(w))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (!week) return null;
  const max = Math.max(1, ...week.days.map((d) => d.focusMinutes));
  const best = week.bestFocusDay ? weekdayOf(week.bestFocusDay) : null;

  return (
    <section className="ach-week" aria-label="Sua semana" data-testid="week">
      <h2>Sua semana</h2>
      <div className="week-cards">
        <div className="week-card">
          <strong data-testid="week-tasks">{week.totals.tasksCompleted}</strong>
          <span>{week.totals.tasksCompleted === 1 ? 'tarefa concluída' : 'tarefas concluídas'}</span>
        </div>
        <div className="week-card">
          <strong data-testid="week-focus">{formatMinutes(week.totals.focusMinutes)}</strong>
          <span>
            de foco · {week.totals.focusSessions} {week.totals.focusSessions === 1 ? 'sessão' : 'sessões'}
          </span>
        </div>
        <div className="week-card">
          <strong>{streak}</strong>
          <span>{streak === 1 ? 'dia seguido' : 'dias seguidos'}</span>
        </div>
      </div>
      <div className="week-bars" role="img" aria-label={`Foco por dia: ${week.days.map((d) => `${weekdayOf(d.day)} ${d.focusMinutes} min`).join(', ')}`}>
        {week.days.map((d, i) => (
          <div className="week-bar" key={d.day} data-today={i === week.days.length - 1} data-best={d.day === week.bestFocusDay}>
            <span className="week-bar-value">{d.focusMinutes > 0 ? d.focusMinutes : ''}</span>
            <span className="week-bar-fill" style={{ height: `${Math.round((d.focusMinutes / max) * 100)}%` }} />
            <span className="week-bar-day">{weekdayOf(d.day)}</span>
          </div>
        ))}
      </div>
      <p className="week-note">
        {week.activeDays === 0
          ? 'Nenhuma atividade nesta semana ainda. Que tal uma sessão de foco?'
          : `${week.activeDays} de 7 dias ativos${best ? ` · mais foco: ${best}` : ''}${week.avgFocusMinutes > 0 ? ` · média de ${formatMinutes(week.avgFocusMinutes)} nos dias de foco` : ''}.`}
      </p>
    </section>
  );
}
