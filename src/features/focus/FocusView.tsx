import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BREAK_MINUTES,
  DEFAULT_FOCUS_MINUTES,
  FOCUS_PRESET_MINUTES,
  formatClock,
  progress,
  remainingNow,
  type FocusState,
} from '../../../shared/focus';
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

/** Modo foco: escolher a duração, acompanhar, pausar, cancelar e ver o fim da sessão. */
export function FocusView({ variant, focus, onBack }: FocusViewProps) {
  const { state } = focus;
  const [minutes, setMinutes] = useState<number>(DEFAULT_FOCUS_MINUTES);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const primary = useRef<HTMLButtonElement | null>(null);
  const previous = useRef(state.status);

  // Anuncia as mudanças para leitores de tela e leva o foco ao botão principal da nova tela.
  useEffect(() => {
    if (previous.current === state.status) return;
    previous.current = state.status;
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

  const now = useNow(state.status === 'running');
  const pct = Math.round(progress(state, now) * 100);
  const active = state.status === 'running' || state.status === 'paused';

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
        {active && <span className="tasks-count">{KIND_LABEL[state.kind]}</span>}
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
                onClick={() => setMinutes(m)}
              >
                {m} min
              </button>
            ))}
          </div>
          <div className="focus-actions">
            <button
              ref={primary}
              type="button"
              className="tasks-add"
              onClick={() => void act(() => focus.start('focus', minutes))}
            >
              Iniciar foco
            </button>
            <button
              type="button"
              className="focus-secondary"
              onClick={() => void act(() => focus.start('break', DEFAULT_BREAK_MINUTES))}
            >
              Pausa de {DEFAULT_BREAK_MINUTES} min
            </button>
          </div>
        </>
      )}

      {active && (
        <>
          <div className="focus-readout">
            <span className="focus-clock" role="timer" aria-label="Tempo restante" data-status={state.status}>
              <FocusClock state={state} />
            </span>
            {state.status === 'paused' && <span className="focus-paused">Pausado</span>}
          </div>
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
            {state.kind === 'focus' ? 'Sessão de foco concluída. Hora de uma pausa!' : 'Pausa concluída. Pronto para focar?'}
          </p>
          <div className="focus-actions">
            <button
              ref={primary}
              type="button"
              className="tasks-add"
              onClick={async () => {
                setError(null);
                const cleared = await focus.cancel();
                if (!cleared.ok) return setError(cleared.error.message);
                const next =
                  state.kind === 'focus'
                    ? await focus.start('break', DEFAULT_BREAK_MINUTES)
                    : await focus.start('focus', minutes);
                if (!next.ok) setError(next.error.message);
              }}
            >
              {state.kind === 'focus' ? `Pausa de ${DEFAULT_BREAK_MINUTES} min` : `Foco de ${minutes} min`}
            </button>
            <button type="button" className="focus-secondary" onClick={() => void act(() => focus.cancel())}>
              Dispensar
            </button>
          </div>
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
