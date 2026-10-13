import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Mascot } from './Mascot';
import { useMascot } from './useMascot';
import { MASCOT_STATES } from './mascotStates';
import { usePresence } from '../island/usePresence';
import { useIsland } from '../island/useIsland';
import { IslandContent, type IslandView } from '../island/IslandContent';
import { useDraft } from '../tasks/draftStore';
import { useFocus } from '../focus/useFocus';
import { FocusBadge } from '../focus/FocusView';
import '../island/island.css';

const DRAG_THRESHOLD_PX = 4;
const DEBUG_KEYS = '1234567890-=';

/** Em unidades do viewBox (200x200). */
const BODY_CENTER = { x: 100, y: 128 };
const EYES_CENTER = { x: 100, y: 124 };
const EYE_MAX_SHIFT = 4;
const FACE_MAX_SHIFT = 2.5;
const LOOK_FULL_DISTANCE_PX = 260;
/**
 * Escala (px por unidade) do mascote flutuante, em que as distâncias dos
 * comportamentos foram calibradas. No modo ilha o mascote é menor, então as
 * distâncias do cursor são convertidas para essa referência.
 */
const REFERENCE_SCALE = 240 / 200;

/** Tempo mínimo de exposição da ilha ao chegar, para a entrada ser vista. */
const ISLAND_FIRST_EXPOSURE_MS = 6000;

/** Janela do mascote: clique, arraste, menu de contexto, cursor global e presença. */
export function MascotView() {
  const mascot = useMascot();
  const { pet, activity, debugSet, cursor, grab, release, greet, celebrate } = mascot;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  // `island` é referenciado pelo callback de presença antes de ser criado: usa ref.
  const islandRef = useRef<ReturnType<typeof useIsland> | null>(null);
  /** Uma sessão de foco terminou com a ilha escondida: ao voltar, abre na tela de foco. */
  const openFocusOnShown = useRef(false);
  const showFocusRef = useRef<() => void>(() => {});
  const { presentation, presenceRef, exitUp } = usePresence({
    onShown: (state) => {
      greet(); // chegou em cena: cumprimenta
      if (state.mode === 'island') {
        islandRef.current?.resume(ISLAND_FIRST_EXPOSURE_MS);
        if (openFocusOnShown.current) {
          openFocusOnShown.current = false;
          showFocusRef.current();
        }
      }
    },
  });
  const mode = presentation?.mode ?? null;
  const island = useIsland(mode, { exit: exitUp });
  islandRef.current = island;

  // Campo de tarefa com foco ou com rascunho: a ilha não recolhe por inatividade.
  const { hold } = useDraft();
  const { setHold } = island;
  useEffect(() => setHold(hold), [hold, setHold]);

  const draggable = mode === 'floating';
  const inIsland = mode === 'island';

  // Tela da ilha expandida. A forma da janela cresce ANTES da animação e só
  // encolhe DEPOIS dela (	ransitionend), como na abertura e no recolhimento.
  const [view, setView] = useState<IslandView>('home');
  const openTasks = async () => {
    await window.mochi.islandExtent('tasks');
    setView('tasks');
  };
  const openFocus = async () => {
    await window.mochi.islandExtent('focus');
    setView('focus');
  };

  // Modo foco (temporizador): o estado vem do main; aqui só se exibe.
  const focus = useFocus();

  // Uma tarefa foi concluída (em qualquer janela): o Mochi comemora.
  // Reabrir ou excluir não disparam este evento.
  useEffect(() => window.mochi.tasks.onCompleted(() => celebrate()), [celebrate]);

  // Uma sessão de foco terminou: o Mochi comemora e a ilha mostra o resultado. Se ela
  // estava escondida, o main a traz de volta e a tela de foco abre quando ela chegar.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  showFocusRef.current = () => {
    island.expand(); // a mensagem de abrir a forma segue antes da de trocar a tela (IPC em ordem)
    void openFocus();
  };
  useEffect(
    () =>
      window.mochi.focus.onFinished(() => {
        celebrate();
        if (modeRef.current === 'island') {
          showFocusRef.current();
        } else {
          openFocusOnShown.current = true;
        }
      }),
    [celebrate],
  );

  // Atalhos para inspecionar cada estado; existem apenas em `npm run dev`.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      const state = MASCOT_STATES[DEBUG_KEYS.indexOf(e.key)];
      if (state) debugSet(state);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [debugSet]);

  // Cursor global: olhos seguem o cursor e o controlador recebe distância/velocidade.
  useEffect(() => {
    let prev: { x: number; y: number; t: number; d: number } | null = null;
    const off = window.mochi.onCursor((p) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      // O SVG mantém a proporção e fica centralizado no menor lado.
      const scale = Math.min(rect.width, rect.height) / 200;
      if (scale <= 0) return;
      const toRef = REFERENCE_SCALE / scale;
      const offX = rect.left + (rect.width - 200 * scale) / 2;
      const offY = rect.top + (rect.height - 200 * scale) / 2;
      const toWin = (u: { x: number; y: number }) => ({ x: offX + u.x * scale, y: offY + u.y * scale });

      const eyes = toWin(EYES_CENTER);
      const ex = p.x - eyes.x;
      const ey = p.y - eyes.y;
      const len = Math.hypot(ex, ey) || 1;
      const mag = Math.min(1, (len * toRef) / LOOK_FULL_DISTANCE_PX);
      const ux = (ex / len) * mag;
      const uy = (ey / len) * mag;
      svg.style.setProperty('--ex', `${(ux * EYE_MAX_SHIFT).toFixed(2)}px`);
      svg.style.setProperty('--ey', `${(uy * EYE_MAX_SHIFT).toFixed(2)}px`);
      svg.style.setProperty('--lx', `${(ux * FACE_MAX_SHIFT).toFixed(2)}px`);
      svg.style.setProperty('--ly', `${(uy * FACE_MAX_SHIFT).toFixed(2)}px`);

      const body = toWin(BODY_CENTER);
      const d = Math.hypot(p.x - body.x, p.y - body.y) * toRef;
      const t = performance.now();
      let speed = 0;
      let approaching = false;
      if (prev && t > prev.t) {
        speed = (Math.hypot(p.x - prev.x, p.y - prev.y) / (t - prev.t)) * 1000;
        approaching = d < prev.d;
      }
      prev = { x: p.x, y: p.y, t, d };
      cursor({ distance: d, speed, approaching });
    });
    return off;
  }, [cursor]);

  /** Cliques em controles (campos, botões) não arrastam nem expandem/recolhem a ilha. */
  const isControl = (e: PointerEvent<HTMLDivElement>) =>
    e.target instanceof Element && e.target.closest('[data-island-control], button, input') !== null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isControl(e)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.screenX, y: e.screenY, dragging: false };
    activity();
    if (draggable) window.mochi.startDrag();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (inIsland) island.activity();
    const p = press.current;
    if (!p || !draggable) return;
    if (!p.dragging) {
      if (Math.hypot(e.screenX - p.x, e.screenY - p.y) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      grab();
    }
    window.mochi.moveDrag();
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    press.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (draggable) window.mochi.endDrag();
    if (p.dragging) release();
    else if (inIsland) island.toggle();
    else pet();
  };

  // Aguarda o main informar a apresentação; a janela é transparente, então nada aparece.
  if (!mode) return null;

  return (
    <div
      className="shell"
      data-mode={mode}
      data-open={inIsland && island.open ? 'true' : 'false'}
      data-view={view}
      onPointerEnter={() => island.setHover(true)}
      onPointerLeave={() => island.setHover(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        activity();
        window.mochi.showMenu();
      }}
    >
      {/* Camada de presença: entra e sai de cena como um todo (animada por Web Animations). */}
      <div className="presence" ref={presenceRef}>
        <div className="island-shadow">
          <div
            className="island"
            onTransitionEnd={(e) => {
              if (e.target !== e.currentTarget || e.propertyName !== 'clip-path') return;
              if (!island.open) {
                island.transitionEnded();
                setView('home');
              } else if (view === 'home') {
                void window.mochi.islandExtent('home'); // voltou à tela inicial: encolhe a forma
              }
            }}
          >
            <IslandContent
              open={inIsland && island.open}
              view={view}
              focus={focus}
              onOpenTasks={() => void openTasks()}
              onOpenFocus={() => void openFocus()}
              onBack={() => setView('home')}
            />
            {inIsland && <FocusBadge state={focus.state} />}
          </div>
        </div>
        <div className="shell-stage">
          <Mascot
            svgRef={svgRef}
            state={mascot.state}
            replay={mascot.replay}
            hop={mascot.hop}
            blinking={mascot.blinking}
            mood={mascot.mood}
            onHopEnd={mascot.endHop}
            onHoverChange={mascot.hoverChange}
          />
        </div>
      </div>
    </div>
  );
}
