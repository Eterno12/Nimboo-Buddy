import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildRoutine, dayKey, pickRoutine, type RoutineKind, type RoutineSummary } from '../../../shared/routine';
import { useCalendar } from '../calendar/useCalendar';
import { useSettings } from '../settings/useSettings';
import { useTasks } from '../tasks/useTasks';

/**
 * Rotina do dia: decide qual cartão (resumo da manhã ou fechamento da noite) está pendente hoje e monta o
 * resumo com os dados vivos (tarefas, agenda, foco). `dismiss` marca o dia como visto (nas preferências).
 */
export function useRoutine() {
  const { settings, update } = useSettings();
  const tasks = useTasks();
  const { state: calendar } = useCalendar();
  const [now, setNow] = useState(() => new Date());
  const [focus, setFocus] = useState({ sessions: 0, minutes: 0 });

  // Reavalia a hora a cada minuto (o fechamento "chega" sozinho).
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Foco do dia: lido ao abrir e quando algo muda nas tarefas (concluir costuma acompanhar sessões).
  useEffect(() => {
    let alive = true;
    void window.mochi.focus.stats().then((s) => {
      if (alive) setFocus({ sessions: s.sessions, minutes: s.minutes });
    });
    return () => {
      alive = false;
    };
  }, [tasks.completed.length, now.getHours()]);

  const kind: RoutineKind | null = pickRoutine({
    now,
    morningEnabled: settings.routineMorning,
    eveningEnabled: settings.routineEvening,
    eveningHour: settings.routineEveningHour,
    lastMorning: settings.routineLastMorning,
    lastEvening: settings.routineLastEvening,
  });

  const summary: RoutineSummary | null = useMemo(
    () =>
      kind
        ? buildRoutine(kind, { now, active: tasks.active, completed: tasks.completed, events: calendar.events, focus })
        : null,
    [kind, now, tasks.active, tasks.completed, calendar.events, focus],
  );

  const dismiss = useCallback(async () => {
    if (!kind) return;
    const key = dayKey(new Date());
    await update(kind === 'morning' ? { routineLastMorning: key } : { routineLastEvening: key });
  }, [kind, update]);

  return { kind, summary, dismiss, ready: tasks.status === 'ready' };
}
