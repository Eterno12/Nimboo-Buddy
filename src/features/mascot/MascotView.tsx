import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Mascot } from './Mascot';
import { characterInfo } from './characters';
import { useMascot } from './useMascot';
import { MASCOT_STATES } from './mascotStates';
import { AMBIENT_SOUNDS } from '../audio/sounds';
import { ANIMATION_LINE, ANIMATION_SOUND } from '../personality/animationReactions';
import { usePresence } from '../island/usePresence';
import { useIsland } from '../island/useIsland';
import { IslandContent, type IslandView } from '../island/IslandContent';
import { useDraft } from '../tasks/draftStore';
import { useFocus } from '../focus/useFocus';
import { FocusBadge } from '../focus/FocusView';
import { useSettings } from '../settings/useSettings';
import { useSpeech } from '../personality/useSpeech';
import { reminderText, type SpeechEvent } from '../personality/personality';
import { STRETCH_TEXT } from '../../../shared/wellness';
import { HARD_TEXT } from '../../../shared/celebration';
import { mediaLayout } from '../../../shared/media';
import type { IslandExtent } from '../../../shared/presentation';
import { useMedia } from '../media/useMedia';
import { useWellness } from '../wellness/useWellness';
import { SpeechBubble } from '../personality/SpeechBubble';
import { useRoutine } from '../routine/useRoutine';
import { dayKey } from '../../../shared/routine';
import { configureSound, playSound } from '../audio/soundEngine';
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
  /** Instante do último cumprimento (para o "happy" dele não virar uma segunda fala). */
  const greetedAt = useRef(0);
  /** O atalho global pediu a ilha com ela escondida: ao voltar, abre direto nas tarefas. */
  const summonOnShown = useRef(false);
  const summonRef = useRef<() => void>(() => {});
  /** `say` só existe depois de `useSpeech` (que depende do estado da ilha): usa ref. */
  const sayRef = useRef<(event: SpeechEvent) => void>(() => {});
  const sayTextRef = useRef<(text: string) => boolean>(() => false);
  const announceRoutineRef = useRef<() => void>(() => {});
  const { presentation, presenceRef, exitUp } = usePresence({
    onShown: (state) => {
      greet(); // chegou em cena: cumprimenta
      greetedAt.current = Date.now();
      sayRef.current('hello');
      announceRoutineRef.current();
      if (state.mode === 'island') {
        islandRef.current?.resume(ISLAND_FIRST_EXPOSURE_MS);
        if (openFocusOnShown.current) {
          openFocusOnShown.current = false;
          showFocusRef.current();
        } else if (summonOnShown.current) {
          summonOnShown.current = false;
          summonRef.current();
        }
      }
    },
  });
  const mode = presentation?.mode ?? null;
  const island = useIsland(mode, { exit: exitUp });
  islandRef.current = island;

  // Preferências: tamanhos, cor, tempo para esconder, sons e balões.
  const { settings, effective } = useSettings();
  const scale = mode === 'island' ? effective.islandScale : effective.mochiScale;
  const { setHideMs } = island;
  useEffect(() => {
    setHideMs(settings.hideDelaySec === 0 ? Infinity : settings.hideDelaySec * 1000);
  }, [settings.hideDelaySec, setHideMs]);
  // Personagem escolhido: o som ganha a "voz" dele e o controlador, o ritmo dele (sem reiniciar nada).
  const character = characterInfo(settings.character);
  const { setTraits } = mascot;
  useEffect(() => {
    configureSound({ enabled: settings.soundEnabled, volume: settings.soundVolume, profile: character.sound });
  }, [settings.soundEnabled, settings.soundVolume, character]);
  useEffect(() => setTraits(character.traits), [character, setTraits]);

  // O humor do Nimboo sobrevive ao app: volta ao afeto guardado e o salva de minuto em minuto.
  const { restoreAffection, getAffection } = mascot;
  useEffect(() => {
    let alive = true;
    void window.mochi.bond
      .get()
      .then((s) => {
        if (alive && s) restoreAffection(s.affection);
      })
      .catch(() => undefined);
    const timer = window.setInterval(() => window.mochi.bond.saveAffection(getAffection()), 60_000);
    const onHide = () => window.mochi.bond.saveAffection(getAffection());
    window.addEventListener('beforeunload', onHide);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', onHide);
    };
  }, [restoreAffection, getAffection]);

  // Campo de tarefa com foco ou com rascunho: a ilha não recolhe por inatividade.
  const { hold } = useDraft();
  const { setHold } = island;
  useEffect(() => setHold(hold), [hold, setHold]);

  const draggable = mode === 'floating';
  const inIsland = mode === 'island';

  // Tela da ilha expandida. A forma da janela cresce ANTES da animação e só
  // encolhe DEPOIS dela (	ransitionend), como na abertura e no recolhimento.
  const [view, setView] = useState<IslandView>('home');

  // Player de música: o que toca no Windows decide quanto a tela inicial da ilha ocupa.
  const media = useMedia();
  const layout = mediaLayout(settings.mediaPlayer, media);
  const homeExtent: IslandExtent = layout === 'playing' ? 'home-player' : layout === 'mini' ? 'home-mini' : 'home';
  const homeExtentRef = useRef(homeExtent);
  const viewRef = useRef(view);
  viewRef.current = view;
  const islandOpenRef = useRef(false);
  islandOpenRef.current = inIsland && island.open;
  const EXTENT_ORDER: Record<string, number> = { home: 0, 'home-mini': 1, 'home-player': 2 };
  // A forma da janela cresce antes da animação e só encolhe depois dela (mesma regra das telas).
  useEffect(() => {
    const previous = homeExtentRef.current;
    homeExtentRef.current = homeExtent;
    if (viewRef.current !== 'home' || !islandOpenRef.current) return;
    if (EXTENT_ORDER[homeExtent] >= EXTENT_ORDER[previous]) {
      void window.mochi.islandExtent(homeExtent);
      return;
    }
    const timer = window.setTimeout(() => void window.mochi.islandExtent(homeExtentRef.current), 360);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeExtent]);
  // Ao abrir a ilha o main começa na forma simples: ajusta ao player já na abertura.
  useEffect(() => {
    if (inIsland && island.open && viewRef.current === 'home') void window.mochi.islandExtent(homeExtentRef.current);
  }, [inIsland, island.open]);
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

  // Balões de fala (personalidade). Ficam de fora enquanto a ilha está aberta.
  const focusActive = focus.state.status === 'running' || focus.state.status === 'paused';
  const speech = useSpeech({
    enabled: settings.bubbles,
    mood: mascot.mood,
    focusActive,
    suppressed: inIsland && island.open,
    extra: character.lines,
  });
  sayRef.current = speech.say;
  sayTextRef.current = speech.sayText;

  // Rotina do dia: o Nimboo anuncia o resumo da manhã / o fechamento (uma vez por dia e por execução).
  const routine = useRoutine();
  const routineRef = useRef(routine);
  routineRef.current = routine;
  const focusActiveForRoutine = useRef(false);
  focusActiveForRoutine.current = focusActive;
  const announcedRoutine = useRef(new Set<string>());
  announceRoutineRef.current = () => {
    const r = routineRef.current;
    if (!r.summary || !r.ready || focusActiveForRoutine.current) return;
    const key = `${r.kind}-${dayKey(new Date())}`;
    if (announcedRoutine.current.has(key)) return;
    announcedRoutine.current.add(key);
    window.setTimeout(() => {
      // lê o resumo no momento de falar (os dados do dia podem ter chegado nesse intervalo)
      const text = routineRef.current.summary?.bubble;
      if (text && sayTextRef.current(text)) playSound('happy');
    }, 2600);
  };
  useEffect(() => {
    if (routine.ready && routine.kind && presentation) announceRoutineRef.current();
  }, [routine.ready, routine.kind, presentation]);

  // Bem-estar: água, postura e olhos (tudo desligado por padrão). Calado durante o foco.
  useWellness({
    settings,
    blocked: focusActive || !presentation,
    say: (text) => sayTextRef.current(text),
    onNudge: () => playSound('happy'),
  });
  const stretchRef = useRef(settings.wellnessStretch);
  stretchRef.current = settings.wellnessStretch;

  // Uma tarefa foi concluída (em qualquer janela): o Nimboo comemora, fala e faz "plim".
  // Reabrir ou excluir não disparam este evento.
  useEffect(
    () =>
      window.mochi.tasks.onCompleted((reason) => {
        celebrate();
        if (reason) {
          // Tarefa difícil: comemoração maior (sininhos de conquista e fala própria).
          playSound('achievement');
          if (!sayTextRef.current(HARD_TEXT[reason])) sayRef.current('taskCompleted');
        } else {
          playSound('taskDone');
          sayRef.current('taskCompleted');
        }
      }),
    [celebrate],
  );
  useEffect(() => window.mochi.tasks.onCreated(() => playSound('tick')), []);

  // Lembrete de prazo: sininhos e um balão com o nome da tarefa (mesmo durante o foco: foi pedido).
  useEffect(
    () =>
      window.mochi.tasks.onReminder((reminder) => {
        playSound('reminder');
        sayTextRef.current(reminderText(reminder));
      }),
    [],
  );

  // Uma sessão de foco terminou: o Nimboo comemora e a ilha mostra o resultado. Se ela
  // estava escondida, o main a traz de volta e a tela de foco abre quando ela chegar.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  showFocusRef.current = () => {
    island.expand(); // a mensagem de abrir a forma segue antes da de trocar a tela (IPC em ordem)
    void openFocus();
  };
  useEffect(
    () =>
      window.mochi.focus.onFinished((kind) => {
        celebrate();
        playSound(kind === 'focus' ? 'focusDone' : 'breakDone');
        sayRef.current(kind === 'focus' ? 'focusFinished' : 'breakFinished');
        if (kind === 'focus' && stretchRef.current) {
          window.setTimeout(() => sayTextRef.current(STRETCH_TEXT), 4500);
        }
        if (modeRef.current === 'island') {
          showFocusRef.current();
        } else {
          openFocusOnShown.current = true;
        }
      }),
    [celebrate],
  );

  // Sons e falas das mudanças do temporizador (início, pausa, retomada).
  const previousFocus = useRef(focus.state.status);
  useEffect(() => {
    const before = previousFocus.current;
    const now = focus.state.status;
    previousFocus.current = now;
    if (before === now) return;
    if (now === 'running' && (before === 'idle' || before === 'finished')) {
      playSound(focus.state.kind === 'focus' ? 'focusStart' : 'tick');
      if (focus.state.kind === 'focus') sayRef.current('focusStart');
    } else if (now === 'running' && before === 'paused') {
      playSound('resume');
    } else if (now === 'paused') {
      playSound('pause');
    }
  }, [focus.state.status, focus.state.kind]);

  // O atalho global pede a ilha: abre direto nas tarefas (com o campo de nova tarefa em foco).
  summonRef.current = () => {
    const anims = presenceRef.current?.getAnimations() ?? [];
    void Promise.allSettled(anims.map((a) => a.finished)).then(() => {
      island.expand();
      void openTasks();
    });
  };
  useEffect(
    () =>
      window.mochi.onSummon(() => {
        if (modeRef.current === 'island') summonRef.current();
        else summonOnShown.current = true;
      }),
    [],
  );

  // Reações do Nimboo ao próprio estado: dormir, acordar, cócegas, emburrar.
  // Cada animação tem a sua assinatura sonora e a sua fala. O som toca sempre (os espontâneos ficam em
  // silêncio durante o foco); a fala passa pela personalidade, que impõe um intervalo entre falas.
  const previousState = useRef(mascot.state);
  const focusActiveRef = useRef(focusActive);
  focusActiveRef.current = focusActive;
  useEffect(() => {
    const before = previousState.current;
    const now = mascot.state;
    previousState.current = now;
    if (before === now && mascot.replay === lastReplay.current) return;
    lastReplay.current = mascot.replay;
    const sound = ANIMATION_SOUND[now];
    if (sound && !(focusActiveRef.current && AMBIENT_SOUNDS.includes(sound))) playSound(sound);
    // Logo depois do cumprimento ao chegar em cena, o "happy" não vira outra fala.
    const justGreeted = now === 'happy' && Date.now() - greetedAt.current < 1200;
    const line = before === 'sleepy' && now === 'stretch' ? 'woke' : ANIMATION_LINE[now];
    if (line && !justGreeted) sayRef.current(line);
  }, [mascot.state, mascot.replay]);
  const lastReplay = useRef(mascot.replay);

  // O pulinho (espontâneo ou ao soltar) faz um "pop" pequeno.
  const wasHopping = useRef(false);
  useEffect(() => {
    if (mascot.hop && !wasHopping.current && !focusActiveRef.current) playSound('pop');
    wasHopping.current = mascot.hop;
  }, [mascot.hop]);

  // De vez em quando, uma frase solta (a personalidade decide se cabe: foco, intervalos, teto/hora).
  useEffect(() => {
    const id = window.setInterval(() => sayRef.current('idle'), 2 * 60_000);
    return () => window.clearInterval(id);
  }, []);

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
    else {
      pet();
      window.mochi.bond.event('pet');
    }
  };

  // Aguarda o main informar a apresentação; a janela é transparente, então nada aparece.
  if (!mode) return null;

  return (
    <div
      className="shell"
      data-mode={mode}
      data-open={inIsland && island.open ? 'true' : 'false'}
      data-view={view}
      data-media={layout}
      data-music={settings.mediaReact && settings.mediaPlayer && media.status === 'playing' ? 'true' : 'false'}
      style={{ '--ui-scale': scale } as CSSProperties}
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
                void window.mochi.islandExtent(homeExtentRef.current); // voltou à tela inicial: ajusta a forma
              }
            }}
          >
            <IslandContent
              open={inIsland && island.open}
              view={view}
              focus={focus}
              onOpenTasks={() => void openTasks()}
              onOpenFocus={() => void openFocus()}
              onOpenNotes={() => window.mochi.notes.openManager()}
              onOpenAssistant={() => window.mochi.assistant.open()}
              onOpenSettings={() => window.mochi.openSettings()}
              onBack={() => setView('home')}
              media={media}
              mediaLayout={layout}
              onMediaCommand={(cmd) => window.mochi.media.command(cmd)}
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
            character={character.id}
            palette={settings.color}
            onHopEnd={mascot.endHop}
            onHoverChange={mascot.hoverChange}
          />
        </div>
        <SpeechBubble bubble={speech.bubble} placement={inIsland ? 'island' : 'floating'} />
      </div>
    </div>
  );
}
