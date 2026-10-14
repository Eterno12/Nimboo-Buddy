import { useEffect, useState, type ReactNode } from 'react';
import {
  currentPosition,
  formatTime,
  nowPlayingText,
  type MediaCommand,
  type MediaLayout,
  type MediaState,
} from '../../../shared/media';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const NoteIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path d="M9 18V6l10-2v12M9 18a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM19 16a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" {...stroke} />
  </svg>
);

function ControlButton({
  label,
  disabled,
  onClick,
  children,
  testId,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button type="button" className="media-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick} data-testid={testId}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        {children}
      </svg>
    </button>
  );
}

const PlayIcon = <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />;
const PauseIcon = (
  <>
    <rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" />
    <rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" />
  </>
);
const PrevIcon = <path d="M7 5.5v13M18 6v12l-8.5-6z" {...stroke} />;
const NextIcon = <path d="M17 5.5v13M6 6v12l8.5-6z" {...stroke} />;

interface MediaCardProps {
  state: MediaState;
  layout: Exclude<MediaLayout, 'off'>;
  /** A ilha está aberta (só então a barra de progresso anda). */
  active: boolean;
  onCommand: (cmd: MediaCommand) => void;
}

/**
 * Player da ilha: uma linha (reduzido) quando nada toca, e o cartão completo com capa, título, progresso e
 * controles quando há música tocando. Textos longos terminam em reticências (o texto completo fica na dica
 * ao passar o mouse); nada aqui toca som sozinho.
 */
export function MediaCard({ state, layout, active, onCommand }: MediaCardProps) {
  const playing = state.status === 'playing';
  const hasTrack = state.available && state.status !== 'none' && (state.title !== '' || state.artist !== '');
  const [now, setNow] = useState(() => Date.now());

  // A barra anda enquanto toca e a ilha está aberta (meio segundo basta).
  useEffect(() => {
    if (!active || !playing || layout !== 'playing') return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [active, playing, layout, state.updatedAt, state.title]);

  const toggleIcon = playing ? PauseIcon : PlayIcon;
  const toggleLabel = playing ? 'Pausar' : 'Tocar';

  if (layout === 'mini') {
    return (
      <section className="island-media" data-layout="mini" aria-label="Player de música" data-testid="media-card">
        <span className="media-note" aria-hidden="true">
          <NoteIcon />
        </span>
        <span className="media-mini-text" title={nowPlayingText(state)}>
          {nowPlayingText(state)}
        </span>
        {hasTrack && (
          <ControlButton
            label={toggleLabel}
            disabled={!state.canPlayPause}
            onClick={() => onCommand({ type: 'toggle' })}
            testId="media-toggle"
          >
            {toggleIcon}
          </ControlButton>
        )}
      </section>
    );
  }

  const position = currentPosition(state, now);
  const fraction = state.durationSec > 0 ? Math.min(1, position / state.durationSec) : 0;
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!state.canSeek || state.durationSec <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    onCommand({ type: 'seek', seconds: f * state.durationSec });
  };

  return (
    <section className="island-media" data-layout="playing" aria-label="Player de música" data-testid="media-card">
      <div className="media-top">
        <div className="media-cover" aria-hidden="true">
          {state.thumbnail ? <img src={state.thumbnail} alt="" draggable={false} /> : <NoteIcon />}
        </div>
        <div className="media-info">
          <strong className="media-title" title={state.title} data-testid="media-title">
            {state.title || 'Faixa sem nome'}
          </strong>
          <span className="media-artist" title={state.artist}>
            {state.artist || 'Artista desconhecido'}
            {state.app ? ` · ${state.app}` : ''}
          </span>
          <div className="media-progress">
            <span className="media-time">{formatTime(position)}</span>
            <div
              className="media-bar"
              data-seekable={state.canSeek && state.durationSec > 0}
              role="progressbar"
              aria-label="Progresso da faixa"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, Math.round(state.durationSec))}
              aria-valuenow={Math.round(position)}
              onClick={seek}
            >
              <span style={{ width: `${Math.round(fraction * 100)}%` }} />
            </div>
            <span className="media-time">{state.durationSec > 0 ? formatTime(state.durationSec) : '--:--'}</span>
          </div>
        </div>
      </div>
      <div className="media-controls">
        <ControlButton label="Anterior" disabled={!state.canPrev} onClick={() => onCommand({ type: 'prev' })} testId="media-prev">
          {PrevIcon}
        </ControlButton>
        <ControlButton
          label={toggleLabel}
          disabled={!state.canPlayPause}
          onClick={() => onCommand({ type: 'toggle' })}
          testId="media-toggle"
        >
          {toggleIcon}
        </ControlButton>
        <ControlButton label="Próxima" disabled={!state.canNext} onClick={() => onCommand({ type: 'next' })} testId="media-next">
          {NextIcon}
        </ControlButton>
      </div>
    </section>
  );
}
