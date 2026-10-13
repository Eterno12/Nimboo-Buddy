import { useEffect, useRef, useState } from 'react';
import {
  FOCUS_MAX_MINUTES,
  FOCUS_MIN_MINUTES,
  FOCUS_PRESET_MINUTES,
  POMODORO_EVERY,
  formatClock,
  progress,
  remainingNow,
  type FocusState,
} from '../../../shared/focus';
import { useTasks } from '../tasks/useTasks';
import { useSettings } from '../settings/useSettings';
import { useNow, type FocusController } from './useFocus';
import '../tasks/tasks.css';
import './focus.css';

/** Tempo restante (mm:ss); só este componente se atualiza a cada quadro do relógio. */
export function FocusClock({ state }: { state: FocusState }) {
  const now = useNow(state.status === 'running');
  return <>{formatClock(remainingNow(state, now))}</>;
}

/** Selo discreto na pílula recolhida: tempo restante enquanto há uma sessão. */
export function FocusBadge({ state }: { state: FocusState }) {
  if (state.status === 'idle') return null;
  return (
    <span className="focus-badge" data-status={state.status} aria-hidden="true">
      {state.status === 'finished' ? '✓' : <FocusClock state={state} />}
    </span>
  );
}

const icon = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

interface FocusViewProps {
  /** `island`: tema escuro, compacto. `panel`: janela do painel. */
  variant: 'island' | 'panel';
  focus: FocusController;
  /** Quando presente, mostra o botão de voltar (usado na ilha). */
  onBack?: () => void;
}

const KIND_LABEL = { focus: 'Foco', break: 'Pausa' } as const;

/** Lê o campo de minutos: inteiro dentro do limite, ou `null`. */
function parseMinutes(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= FOCUS_MIN_MINUTES && n <= FOCUS_MAX_MINUTES ? n : null;
}

/** Modo foco: tempo livre, tarefa vinculada, ciclo Pomodoro e o resultado de cada sessão. */
export function FocusView({ variant, focus, onBack }: FocusViewProps) {
  const { state, stats } = focus;
  const { settings, update } = useSettings();
  const { active: tasks, complete } = useTasks();
  const [minutesText, setMinutesText] = useState<string>(String(settings.focusMinutes));
  const [taskId, setTaskId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [taskDone, setTaskDone] = useState(false);
  const primary = useRef<HTMLButtonElement | null>(null);
  const previous = useRef(state.status);
  const seededMinutes = useRef(false);

  // O último tempo usado (preferência) aparece no campo assim que as preferências chegam.
  useEffect(() => {
    if (seededMinutes.current) return;
    seededMinutes.current = true;
    setMinutesText(String(settings.focusMinutes));
  }, [settings.focusMinutes]);

  // Anuncia as mudanças para leitores de tela e leva o foco ao botão principal da nova tela.
  useEffect(() => {
    if (previous.current === state.status) return;
    previous.current = state.status;
    setTaskDone(false);
    const label = KIND_LABEL[state.kind].toLowerCase();
    setAnnouncement(
      state.status === 'running'
        ? `Sessão de ${label} em andamento.`
        : state.status === 'paused'
          ? 'Sessão pausada.'
          : state.status === 'finished'
            ? `Sessão de ${label} concluída.`
            : 'Sessão cancelada.',
    );
    primary.current?.focus();
  }, [state.status, state.kind]);

  /** Executa uma ação e mostra o motivo, em português, se o main recusar. */
  const act = async (op: () => ReturnType<FocusController['pause']>) => {
    setError(null);
    const result = await op();
    if (!result.ok) setError(result.error.message);
  };

  const minutes = parseMinutes(minutesText);
  const selectedTask = tasks.find((t) => t.id === taskId) ?? null;

  const startFocus = () => {
    if (minutes === null) {
      setError(`Digite de ${FOCUS_MIN_MINUTES} a ${FOCUS_MAX_MINUTES} minutos.`);
      return;
    }
    void update({ focusMinutes: minutes }); // lembra o último tempo usado
    void act(() => focus.start('focus', minutes, selectedTask && { id: selectedTask.id, title: selectedTask.title }));
  };

  const now = useNow(state.status === 'running');
  const pct = Math.round(progress(state, now) * 100);
  const running = state.status === 'running' || state.status === 'paused';
  const next = state.next;
  const cycleBadge = state.cycleEnabled
    ? state.status !== 'idle' && state.kind === 'focus' && running
      ? `Foco ${Math.min(state.cycleCount + 1, POMODORO_EVERY)}/${POMODORO_EVERY}`
      : `${state.cycleCount}/${POMODORO_EVERY}`
    : running
      ? KIND_LABEL[state.kind]
      : null;

  return (
    <section className="tasks focus" data-variant={variant} data-island-control aria-label="Modo foco">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <header className="tasks-header">
        {onBack && (
          <button type="button" className="tasks-icon-button" onClick={onBack} aria-label="Voltar aos atalhos">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M15 5l-7 7 7 7" {...icon} />
            </svg>
          </button>
        )}
        <h2>Modo foco</h2>
        {cycleBadge && (
          <span className="tasks-count" title={state.cycleEnabled ? 'Ciclo Pomodoro: focos concluídos' : undefined}>
            {cycleBadge}
          </span>
        )}
      </header>

      {state.status === 'idle' && (
        <>
          <div className="focus-presets" role="radiogroup" aria-label="Duração do foco">
            {FOCUS_PRESET_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                className="focus-chip"
                onClick={() => {
                  setMinutesText(String(m));
                  setError(null);
                }}
              >
                {m}
              </button>
            ))}
            <label className="focus-custom">
              <input
                type="number"
                inputMode="numeric"
                min={FOCUS_MIN_MINUTES}
                max={FOCUS_MAX_MINUTES}
                value={minutesText}
                aria-label="Minutos de foco (de 1 a 180)"
                aria-invalid={minutes === null ? true : undefined}
                onChange={(e) => {
                  setMinutesText(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') startFocus();
                }}
              />
              <span aria-hidden="true">min</span>
            </label>
          </div>
          {tasks.length > 0 && (
            <select
              className="focus-task"
              value={taskId}
              aria-label="Tarefa deste foco (opcional)"
              onChange={(e) => setTaskId(e.target.value)}
            >
              <option value="">Sem tarefa vinculada</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
          <div className="focus-actions">
            <button ref={primary} type="button" className="tasks-add" onClick={startFocus}>
              {minutes !== null ? `Foco de ${minutes} min` : 'Iniciar foco'}
            </button>
            <button
              type="button"
              className="focus-secondary"
              onClick={() => void act(() => focus.start('break', settings.breakMinutes))}
            >
              Pausa de {settings.breakMinutes} min
            </button>
          </div>
          {stats.sessions > 0 && (
            <p className="focus-stats">
              Hoje: {stats.sessions} {stats.sessions === 1 ? 'sessão' : 'sessões'} · {stats.minutes} min
            </p>
          )}
        </>
      )}

      {running && (
        <>
          <div className="focus-readout">
            <span className="focus-clock" role="timer" aria-label="Tempo restante" data-status={state.status}>
              <FocusClock state={state} />
            </span>
            {state.status === 'paused' && <span className="focus-paused">Pausado</span>}
          </div>
          {state.task && <p className="focus-linked">{state.task.title}</p>}
          <div className="focus-bar" aria-hidden="true">
            <div className="focus-bar-fill" style={{ transform: `scaleX(${pct / 100})` }} />
          </div>
          <div className="focus-actions">
            <button
              ref={primary}
              type="button"
              className="tasks-add"
              onClick={() => void act(() => (state.status === 'running' ? focus.pause() : focus.resume()))}
            >
              {state.status === 'running' ? 'Pausar' : 'Retomar'}
            </button>
            <button type="button" className="focus-secondary" onClick={() => void act(() => focus.cancel())}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {state.status === 'finished' && (
        <>
          <p className="focus-done">
            {state.kind === 'focus'
              ? next?.long
                ? 'Quatro focos! Hora da pausa longa.'
                : 'Sessão de foco concluída. Hora de uma pausa!'
              : 'Pausa concluída. Pronto para focar?'}
          </p>
          {state.kind === 'focus' && state.task && (
            <button
              type="button"
              className="focus-secondary focus-complete"
              disabled={taskDone}
              onClick={async () => {
                setError(null);
                const result = await complete(state.task!.id);
                if (result.ok) setTaskDone(true);
                else setError(result.error.message);
              }}
            >
              {taskDone ? 'Tarefa concluída ✓' : `Concluir "${state.task.title}"`}
            </button>
          )}
          <div className="focus-actions">
            <button
              ref={primary}
              type="button"
              className="tasks-add"
              onClick={() => next && void act(() => focus.start(next.kind, next.minutes))}
            >
              {next
                ? next.kind === 'break'
                  ? `${next.long ? 'Pausa longa' : 'Pausa'} de ${next.minutes} min`
                  : `Foco de ${next.minutes} min`
                : 'Continuar'}
            </button>
            <button type="button" className="focus-secondary" onClick={() => void act(() => focus.cancel())}>
              Dispensar
            </button>
          </div>
          {state.cycleEnabled && settings.pomodoroAuto && (
            <p className="focus-stats">Seguindo para a próxima etapa em instantes…</p>
          )}
        </>
      )}

      {error && (
        <p className="tasks-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
