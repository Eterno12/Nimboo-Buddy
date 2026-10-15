import { useEffect, useState } from 'react';
import {
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  FOCUS_PRESET_MINUTES,
  POMODORO_EVERY,
  formatClock,
  progress,
  remainingNow,
} from '../../../shared/focus';
import type { Task } from '../../../shared/tasks';
import type { Core } from '../core';
import { Icon } from '../ui/Icon';

const R = 108;
const C = 2 * Math.PI * R;

/** Relógio que "bate" 4 vezes por segundo enquanto a sessão corre. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

interface Props {
  core: Core;
  tasks: Task[];
  onCompleteTask(task: Task): void;
}

/** Foco: temporizador (o mesmo motor do PC), ciclo Pomodoro opcional e tarefa vinculada. */
export function FocusScreen({ core, tasks, onCompleteTask }: Props) {
  const state = core.focus.getState();
  const config = core.focusConfig();
  const [taskId, setTaskId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const running = state.status === 'running';
  const now = useNow(running);
  const mains = tasks.filter((t) => t.parentId === null && !t.completed);

  const remaining = remainingNow(state, now);
  const fraction = state.status === 'idle' ? 0 : progress(state, now);
  const linked = state.task ? (tasks.find((t) => t.id === state.task?.id) ?? null) : null;
  const stats = core.focusToday();

  const start = async (kind: 'focus' | 'break', minutes: number) => {
    setError(null);
    await core.notifier.requestPermission();
    const t = kind === 'focus' ? mains.find((x) => x.id === taskId) : undefined;
    const r = core.focus.start(kind, minutes, t ? { id: t.id, title: t.title } : null);
    if (!r.ok) setError(r.error.message);
  };

  const setMinutes = (m: number) => {
    const clamped = Math.min(FOCUS_MAX_MINUTES, Math.max(FOCUS_MIN_MINUTES, Math.round(m)));
    core.setFocusConfig({ ...config, focusMinutes: clamped });
  };

  const label = state.kind === 'focus' ? 'Foco' : state.cycleEnabled && state.next?.long ? 'Pausa longa' : 'Pausa';

  return (
    <div className="screen" data-testid="screen-focus" data-status={state.status}>
      <header className="screen-head">
        <h1>Foco</h1>
      </header>

      <div className="focus-ring" aria-live="off">
        <svg viewBox="0 0 240 240" width="240" height="240" aria-hidden="true">
          <circle cx="120" cy="120" r={R} className="ring-track" />
          <circle
            cx="120"
            cy="120"
            r={R}
            className="ring-prog"
            data-kind={state.kind}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - fraction)}
            transform="rotate(-90 120 120)"
          />
        </svg>
        <div className="focus-center">
          <strong data-testid="focus-clock">{formatClock(state.status === 'idle' ? config.focusMinutes * 60_000 : remaining)}</strong>
          <span>
            {state.status === 'idle' ? 'pronto' : state.status === 'finished' ? 'concluído' : state.status === 'paused' ? `${label} · pausado` : label}
          </span>
        </div>
      </div>

      {state.cycleEnabled && (
        <div className="cycle-dots" aria-label={`${state.cycleCount} de ${POMODORO_EVERY} focos no ciclo`}>
          {Array.from({ length: POMODORO_EVERY }, (_, i) => (
            <i key={i} data-on={i < state.cycleCount} />
          ))}
        </div>
      )}

      {state.task && state.status !== 'idle' && (
        <p className="focus-task" data-testid="focus-task">
          {state.task.title}
        </p>
      )}

      {state.status === 'idle' && (
        <section className="card" aria-label="Preparar foco">
          <div className="chips" role="radiogroup" aria-label="Duração">
            {FOCUS_PRESET_MINUTES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={config.focusMinutes === m} className="chip-btn" data-active={config.focusMinutes === m} onClick={() => setMinutes(m)}>
                {m} min
              </button>
            ))}
          </div>
          <div className="stepper">
            <button type="button" className="btn-soft" aria-label="Menos 5 minutos" onClick={() => setMinutes(config.focusMinutes - 5)}>
              −5
            </button>
            <span>{config.focusMinutes} min</span>
            <button type="button" className="btn-soft" aria-label="Mais 5 minutos" onClick={() => setMinutes(config.focusMinutes + 5)}>
              +5
            </button>
          </div>
          <label className="field">
            <span>Tarefa (opcional)</span>
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} data-testid="focus-task-select">
              <option value="">Sem tarefa</option>
              {mains.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={config.cycle} onChange={(e) => core.setFocusConfig({ ...config, cycle: e.target.checked })} data-testid="focus-cycle" />
            <span>Ciclo Pomodoro (pausa longa a cada {POMODORO_EVERY} focos)</span>
          </label>
          <button type="button" className="btn-primary" data-testid="focus-start" onClick={() => void start('focus', config.focusMinutes)}>
            <Icon name="focus" size={20} /> Iniciar foco
          </button>
        </section>
      )}

      {(state.status === 'running' || state.status === 'paused') && (
        <div className="row focus-actions">
          {running ? (
            <button type="button" className="btn-primary" data-testid="focus-pause" onClick={() => core.focus.pause()}>
              Pausar
            </button>
          ) : (
            <button type="button" className="btn-primary" data-testid="focus-resume" onClick={() => core.focus.resume()}>
              Retomar
            </button>
          )}
          <button type="button" className="btn-soft" data-testid="focus-cancel" onClick={() => core.focus.cancel()}>
            Cancelar
          </button>
        </div>
      )}

      {state.status === 'finished' && (
        <section className="card" data-testid="focus-finished">
          <h2>{state.kind === 'focus' ? 'Foco concluído!' : 'Pausa concluída!'}</h2>
          {linked && state.kind === 'focus' && (
            <button type="button" className="btn-soft" onClick={() => onCompleteTask(linked)}>
              <Icon name="check" size={18} /> Concluir “{linked.title}”
            </button>
          )}
          {state.next && (
            <button type="button" className="btn-primary" data-testid="focus-next" onClick={() => void start(state.next!.kind, state.next!.minutes)}>
              Iniciar {state.next.kind === 'break' ? (state.next.long ? 'pausa longa' : 'pausa') : 'foco'} de {state.next.minutes} min
            </button>
          )}
          <button type="button" className="btn-soft" data-testid="focus-dismiss" onClick={() => core.focus.cancel()}>
            Dispensar
          </button>
        </section>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <p className="muted small" data-testid="focus-today">
        Hoje: {stats.sessions} {stats.sessions === 1 ? 'sessão' : 'sessões'} · {stats.minutes} min
      </p>
    </div>
  );
}
