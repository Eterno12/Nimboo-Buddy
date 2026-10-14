import { useEffect, useRef, type ReactNode } from 'react';
import { TasksView } from '../tasks/TasksView';
import { FocusClock, FocusView } from '../focus/FocusView';
import type { FocusController } from '../focus/useFocus';
import type { FocusState } from '../../../shared/focus';
import type { MediaCommand, MediaLayout, MediaState } from '../../../shared/media';
import { MediaCard } from '../media/MediaCard';

/** Texto do atalho de foco: tempo restante (ou "ok") enquanto há uma sessão. */
function FocusBadgeText({ state }: { state: FocusState }) {
  return state.status === 'finished' ? <>✓</> : <FocusClock state={state} />;
}

interface Shortcut {
  id: 'tasks' | 'timer' | 'notes' | 'assistant';
  label: string;
  icon: ReactNode;
}

/** Ícones vetoriais próprios (traço de 1,75, 24x24), sem emoji nem imagens externas. */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const SHORTCUTS: Shortcut[] = [
  {
    id: 'tasks',
    label: 'Tarefas',
    icon: <path d="M4 7l2 2 3.5-4M4 16l2 2 3.5-4M13 8h7M13 17h7" {...stroke} />,
  },
  {
    id: 'timer',
    label: 'Temporizador',
    icon: (
      <>
        <circle cx="12" cy="13.5" r="6.5" {...stroke} />
        <path d="M12 10v3.5l2.3 1.7M9.5 3.5h5" {...stroke} />
      </>
    ),
  },
  {
    id: 'notes',
    label: 'Notas',
    icon: <path d="M6 4h8.5L18 7.5V20H6zM9 11h6M9 15h4" {...stroke} />,
  },
  {
    id: 'assistant',
    label: 'Assistente',
    icon: <path d="M12 4l1.9 4.9L19 10.8l-5.1 1.9L12 17.6l-1.9-4.9L5 10.8l5.1-1.9z" {...stroke} />,
  },
];

export type IslandView = 'home' | 'tasks' | 'focus';

interface IslandContentProps {
  open: boolean;
  view: IslandView;
  focus: FocusController;
  onOpenTasks: () => void;
  onOpenFocus: () => void;
  /** Abre a janela de notas. */
  onOpenNotes: () => void;
  /** Abre a janela do assistente. */
  onOpenAssistant: () => void;
  /** Abre o painel nas configurações. */
  onOpenSettings: () => void;
  onBack: () => void;
  /** Player de música: estado, como ocupa a tela inicial e o envio de comandos. */
  media: MediaState;
  mediaLayout: MediaLayout;
  onMediaCommand: (cmd: MediaCommand) => void;
}

/**
 * Conteúdo da ilha expandida: atalhos (tela inicial) ou tarefas. Os atalhos
 * ainda sem função ficam desabilitados com semântica real (`disabled`), e nada
 * aparece para o teclado enquanto a ilha está recolhida (`inert`).
 */
export function IslandContent({
  open,
  view,
  focus,
  onOpenTasks,
  onOpenFocus,
  onOpenNotes,
  onOpenAssistant,
  onOpenSettings,
  onBack,
  media,
  mediaLayout,
  onMediaCommand,
}: IslandContentProps) {
  const tasksShortcut = useRef<HTMLButtonElement | null>(null);
  const timerShortcut = useRef<HTMLButtonElement | null>(null);
  const previousView = useRef<IslandView>(view);

  // Ao voltar de uma tela (tarefas, foco), o foco volta ao atalho que a abriu.
  useEffect(() => {
    if (view === 'home' && open) {
      if (previousView.current === 'tasks') tasksShortcut.current?.focus();
      else if (previousView.current === 'focus') timerShortcut.current?.focus();
    }
    previousView.current = view;
  }, [view, open]);

  const sessionActive = focus.state.status !== 'idle';

  return (
    <div className="island-content" inert={!open} aria-hidden={!open}>
      {view === 'tasks' ? (
        <div className="island-tasks">
          <TasksView variant="island" onBack={onBack} />
        </div>
      ) : view === 'focus' ? (
        <div className="island-focus">
          <FocusView variant="island" focus={focus} onBack={onBack} />
        </div>
      ) : (
        <>
        <ul className="island-shortcuts" aria-label="Atalhos">
          {SHORTCUTS.map((s) => {
            const enabled = s.id === 'tasks' || s.id === 'timer' || s.id === 'notes' || s.id === 'assistant';
            return (
              <li key={s.id}>
                <button
                  type="button"
                  ref={s.id === 'tasks' ? tasksShortcut : s.id === 'timer' ? timerShortcut : undefined}
                  className="island-shortcut"
                  disabled={!enabled}
                  title={enabled ? undefined : 'Em breve'}
                  onClick={
                    s.id === 'tasks' ? onOpenTasks : s.id === 'timer' ? onOpenFocus : s.id === 'notes' ? onOpenNotes : s.id === 'assistant' ? onOpenAssistant : undefined
                  }
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    {s.icon}
                  </svg>
                  <span>
                    {s.id === 'timer' ? (
                      <>
                        Foco
                        {sessionActive && (
                          <>
                            {' '}
                            <FocusBadgeText state={focus.state} />
                          </>
                        )}
                      </>
                    ) : (
                      s.label
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {mediaLayout !== 'off' && (
          <MediaCard state={media} layout={mediaLayout} active={open} onCommand={onMediaCommand} />
        )}
        </>
      )}
      {view === 'home' && (
        <button
          type="button"
          className="island-gear"
          onClick={onOpenSettings}
          aria-label="Abrir configurações"
          title="Configurações"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="3" {...stroke} />
            <path
              d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
              {...stroke}
            />
          </svg>
        </button>
      )}
    </div>
  );
}