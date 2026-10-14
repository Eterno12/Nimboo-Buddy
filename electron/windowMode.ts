import { ipcMain, screen, type BrowserWindow, type Display } from 'electron';
import { IPC } from '../shared/ipc';
import {
  bottomCornerBounds,
  clampRectToArea,
  edgeHintBounds,
  fitScale,
  floatingBounds,
  islandBounds,
  pickDisplayForRect,
  resolveIslandDisplay,
  scaleSize,
  type DisplayInfo,
  type Rect,
} from '../shared/geometry';
import {
  EDGE_HINT_SIZE,
  EDGE_REVEAL_HALF_WIDTH,
  ISLAND_WINDOW_SIZE,
  islandShapes,
  type Entrance,
  ISLAND_EXTENTS,
  type IslandExtent,
  type PresentationState,
} from '../shared/presentation';
import { STARTUP_MODE, type PresentationMode } from '../shared/settings';
import {
  createEdgeHintWindow,
  createMascotWindow,
  EDGE_HINT_FADE_JS,
  EDGE_HINT_RESET_JS,
  MASCOT_SIZE,
} from './windows';
import type { SettingsStore } from './settingsStore';

const toInfo = (d: Display): DisplayInfo => ({ id: d.id, bounds: d.bounds, workArea: d.workArea });
const allDisplays = (): DisplayInfo[] => screen.getAllDisplays().map(toInfo);
const primaryId = (): number => screen.getPrimaryDisplay().id;

/** Tempo máximo que uma troca espera o renderer desenhar o novo layout. */
const APPLY_ACK_TIMEOUT_MS = 300;
/** Tempo máximo que a volta à ilha espera a animação de saída do Nimboo. */
const LEAVE_TIMEOUT_MS = 500;
/** Revelar a ilha: cursor na borda superior, perto do centro, por este tempo. */
const REVEAL_DWELL_MS = 250;
const REVEAL_HALF_WIDTH = EDGE_REVEAL_HALF_WIDTH;
/** Duração do esmaecer da linha-dica quando a ilha surge a partir dela. */
const EDGE_HINT_FADE_MS = 200;
/** Depois que o Nimboo surge no canto, ignora a borda por um instante. */
const AWAY_COOLDOWN_MS = 1500;

export interface WindowModeManager {
  readonly window: BrowserWindow;
  /** Modo preferido (o que fica salvo). */
  getMode(): PresentationMode;
  /** Layout em uso agora: `island` só com a ilha à vista; o Nimboo no canto é `floating`. */
  getPresentation(): PresentationMode;
  /** O modo preferido é a ilha, mas ela está escondida e o Nimboo está no canto. */
  isAway(): boolean;
  isIslandOpen(): boolean;
  /** Reaplica tamanhos (e posição) depois de uma mudança de configuração. */
  refreshLayout(): void;
  /** Fatores efetivos (o pedido, limitado ao monitor). */
  getScales(): { islandScale: number; mochiScale: number };
  /** Traz o mascote e leva à ilha pronta para uso (atalho global). */
  summon(): Promise<void>;
  setMode(mode: PresentationMode): Promise<void>;
  toggleMode(): Promise<void>;
  /** Traz a ilha de volta (a partir do Nimboo no canto). */
  showIsland(): Promise<void>;
  /** Pede ao renderer para alternar a ilha (alternativa ao clique). */
  requestIslandToggle(): void;
  /** Alimenta a revelação pela borda superior. Chamar a cada amostra do cursor. */
  onCursor(point: { x: number; y: number }): void;
  dispose(): void;
}

/**
 * Dono da janela do mascote. Há uma única janela, sempre com o mesmo renderer,
 * então o estado do mascote (expressão, humor, timers) sobrevive a qualquer troca.
 *
 * Apresentações:
 *  - ilha: janela 352x174 fixa no topo; expandir só muda a forma (`setShape`);
 *  - flutuante: janela 240x240 solta; no modo ilha, o Nimboo "fora da ilha"
 *    também usa este layout, num canto inferior, enquanto a ilha está escondida.
 */
export function createWindowModeManager(settings: SettingsStore): WindowModeManager {
  // O app SEMPRE abre como ilha. Se o modo flutuante estava salvo (escolhido na sessão anterior),
  // ele só vale até fechar: a posição flutuante continua lembrada para quando for escolhido de novo.
  let mode: PresentationMode = STARTUP_MODE;
  if (settings.get().mode !== STARTUP_MODE) settings.update({ mode: STARTUP_MODE });
  let away = false;
  let islandOpen = false;
  let islandExtent: IslandExtent = 'home';
  let busy = false; // troca ou volta à ilha em andamento
  let pendingEntrance: Entrance = mode === 'island' ? { kind: 'drop' } : null;
  let applyAck: (() => void) | null = null;
  let leaveAck: (() => void) | null = null;
  let awayAt = 0;
  let edgeSince: number | null = null;
  let lastCorner: 'left' | 'right' = 'left';
  let edgeHint: BrowserWindow | null = null;
  let edgeHintTimer: ReturnType<typeof setTimeout> | undefined;
  /** A ilha começou a se esconder (animação de saída em curso). */
  let hiding = false;
  /** Há um balão de fala visível (a forma da ilha recolhida cresce para incluí-lo). */
  let bubbleVisible = false;

  const islandDisplay = (): DisplayInfo =>
    resolveIslandDisplay(settings.get().displayId, allDisplays(), primaryId());
  /** Tamanhos efetivos: o pedido nas preferências, limitado ao que cabe no monitor. */
  const sizes = () => {
    const s = settings.get();
    const area = islandDisplay().workArea;
    return {
      islandScale: fitScale(s.islandScale, ISLAND_WINDOW_SIZE, area),
      mochiSize: Math.round(MASCOT_SIZE * fitScale(s.mochiScale, { width: MASCOT_SIZE, height: MASCOT_SIZE }, area)),
    };
  };
  const shapesNow = () => islandShapes(islandOpen, islandExtent, sizes().islandScale, bubbleVisible);
  const islandRect = (): Rect =>
    islandBounds(islandDisplay(), scaleSize(ISLAND_WINDOW_SIZE, sizes().islandScale));
  const floatingTarget = (): Rect => {
    const s = settings.get();
    return floatingBounds(s.floating, sizes().mochiSize, allDisplays(), primaryId(), s.displayId);
  };

  const presentationMode = (): PresentationMode => (mode === 'island' && !away ? 'island' : 'floating');

  // Última posição flutuante "padrão" aplicada; serve para não fixá-la sem o usuário mover.
  let baseline: Rect = mode === 'floating' ? floatingTarget() : { x: 0, y: 0, width: 0, height: 0 };
  const initial = mode === 'island' ? islandRect() : baseline;
  const window = createMascotWindow(initial, { focusable: mode === 'floating' });
  if (mode === 'island') window.setShape(shapesNow());

  /** Esconde a linha-dica (a ilha voltou, o modo mudou, o mascote foi ocultado ou o app encerra). */
  const hideEdgeHint = () => {
    clearTimeout(edgeHintTimer);
    hiding = false;
    if (edgeHint && !edgeHint.isDestroyed()) edgeHint.hide();
  };
  /**
   * A ilha está surgindo a partir da linha: ela esmaece enquanto a ilha cresce e some em seguida.
   * (A janela da linha e a da ilha são distintas; a troca é feita sem corte.)
   */
  const fadeOutEdgeHint = () => {
    clearTimeout(edgeHintTimer);
    hiding = false;
    const hint = edgeHint;
    if (!hint || hint.isDestroyed() || !hint.isVisible()) return;
    void hint.webContents.executeJavaScript(EDGE_HINT_FADE_JS).catch(() => {});
    edgeHintTimer = setTimeout(() => {
      if (!hint.isDestroyed()) hint.hide();
    }, EDGE_HINT_FADE_MS);
  };
  /**
   * Mostra a linha-dica no topo do monitor da ilha: no instante em que a ilha começa a se esconder
   * (`hiding`) e enquanto o Nimboo estiver no canto (`away`) e visível.
   */
  const showEdgeHint = (delay = 0) => {
    clearTimeout(edgeHintTimer);
    edgeHintTimer = setTimeout(() => {
      if (!(away || hiding) || window.isDestroyed() || !window.isVisible()) return;
      const bounds = edgeHintBounds(islandDisplay(), EDGE_HINT_SIZE);
      if (edgeHint && !edgeHint.isDestroyed()) {
        if (edgeHint.isVisible()) return; // já está à vista (ex.: seguiu da saída da ilha para o canto)
        edgeHint.setBounds(bounds);
        void edgeHint.webContents.executeJavaScript(EDGE_HINT_RESET_JS).catch(() => {});
        edgeHint.showInactive();
        return;
      }
      const created = createEdgeHintWindow(bounds);
      edgeHint = created;
      created.once('ready-to-show', () => {
        if ((away || hiding) && !created.isDestroyed()) created.showInactive();
      });
    }, delay);
  };
  // Mascote ocultado pelo usuário → sem linha; reexibido no canto → linha de volta.
  window.on('hide', hideEdgeHint);
  window.on('show', () => {
    if (away) showEdgeHint(0);
  });
  window.on('closed', () => {
    hideEdgeHint();
    if (edgeHint && !edgeHint.isDestroyed()) edgeHint.destroy();
  });

  /** Layouts: cada um troca tamanho, forma e foco de uma vez. */
  const layoutIsland = () => {
    islandOpen = false;
    islandExtent = 'home';
    window.setFocusable(false);
    bubbleVisible = false;
    window.setBounds(islandRect());
    window.setShape(shapesNow());
  };
  const layoutFloating = (bounds: Rect) => {
    bubbleVisible = false;
    window.setFocusable(true);
    window.setBounds(bounds);
    // Forma vazia desligaria a janela inteira; "sem forma" é o retângulo todo.
    window.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }]);
  };

  /**
   * Guarda a posição flutuante só se o usuário a mudou: o evento 'move' também
   * dispara no posicionamento inicial. Na ilha e no Nimboo do canto (temporário)
   * a posição não é do usuário.
   */
  const persistPosition = () => {
    if (mode !== 'floating' || away || busy || window.isDestroyed()) return;
    const [x, y] = window.getPosition();
    const saved = settings.get().floating;
    const unchanged = saved ? saved.x === x && saved.y === y : x === baseline.x && y === baseline.y;
    if (!unchanged) settings.update({ floating: { x, y } });
  };
  window.on('move', persistPosition);

  /** Monitores mudaram: a ilha reancora; o mascote solto volta à vista. */
  const onDisplayChange = () => {
    if (window.isDestroyed() || busy) return;
    const current = window.getBounds();
    const target =
      presentationMode() === 'island'
        ? islandRect()
        : floatingBounds({ x: current.x, y: current.y }, current.width, allDisplays(), primaryId());
    if (target.x !== current.x || target.y !== current.y) {
      window.setBounds({ x: target.x, y: target.y, width: current.width, height: current.height });
    }
    if (edgeHint && !edgeHint.isDestroyed() && edgeHint.isVisible()) {
      edgeHint.setBounds(edgeHintBounds(islandDisplay(), EDGE_HINT_SIZE));
    }
  };
  screen.on('display-removed', onDisplayChange);
  screen.on('display-metrics-changed', onDisplayChange);

  const fromWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    !window.isDestroyed() && event.sender === window.webContents;

  ipcMain.handle(IPC.getPresentation, (event): PresentationState => {
    if (!fromWindow(event)) throw new Error('Remetente não autorizado');
    const entrance = pendingEntrance;
    pendingEntrance = null; // a entrada é entregue uma única vez
    return { mode: presentationMode(), entrance };
  });

  const onApplied = (event: Electron.IpcMainEvent) => {
    if (fromWindow(event)) applyAck?.();
  };
  ipcMain.on(IPC.presentationApplied, onApplied);

  /** Libera a forma cheia (antes da animação de abrir) e dá foco para o teclado. */
  ipcMain.handle(IPC.islandOpen, (event) => {
    if (!fromWindow(event)) throw new Error('Remetente não autorizado');
    if (presentationMode() !== 'island' || busy) return;
    islandOpen = true;
    islandExtent = 'home';
    window.setShape(shapesNow());
    window.setFocusable(true);
    window.focus();
  });
  /** Ajusta a forma da ilha aberta à tela atual (maior antes de crescer, menor depois de encolher). */
  ipcMain.handle(IPC.islandExtent, (event, extent: unknown) => {
    if (!fromWindow(event)) throw new Error('Remetente não autorizado');
    if (typeof extent !== 'string' || !(ISLAND_EXTENTS as readonly string[]).includes(extent)) return;
    if (presentationMode() !== 'island' || busy || !islandOpen) return;
    islandExtent = extent as IslandExtent;
    window.setShape(shapesNow());
  });
  /** Volta à forma compacta depois da animação de recolher e libera o foco. */
  const onIslandClosed = (event: Electron.IpcMainEvent) => {
    if (!fromWindow(event) || presentationMode() !== 'island' || !islandOpen) return;
    islandOpen = false;
    islandExtent = 'home';
    window.setFocusable(false);
    window.setShape(shapesNow());
  };
  ipcMain.on(IPC.islandClosed, onIslandClosed);

  /** A ilha começou a recolher para o topo: a linha aparece agora, no mesmo instante. */
  const onIslandHiding = (event: Electron.IpcMainEvent) => {
    if (!fromWindow(event) || presentationMode() !== 'island' || busy) return;
    hiding = true;
    showEdgeHint(0);
  };
  ipcMain.on(IPC.islandHiding, onIslandHiding);

  const onIslandHidden = (event: Electron.IpcMainEvent) => {
    if (fromWindow(event)) void goAway();
  };
  ipcMain.on(IPC.islandHidden, onIslandHidden);

  const onLeaveDone = (event: Electron.IpcMainEvent) => {
    if (fromWindow(event)) leaveAck?.();
  };
  ipcMain.on(IPC.leaveDone, onLeaveDone);

  /** Troca de layout com a janela invisível, para não haver quadro desencontrado. */
  async function transition(apply: () => void, state: PresentationState): Promise<void> {
    busy = true;
    try {
      window.setOpacity(0);
      apply();
      window.webContents.send(IPC.presentationChanged, state);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, APPLY_ACK_TIMEOUT_MS);
        applyAck = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    } finally {
      applyAck = null;
      if (!window.isDestroyed()) window.setOpacity(1);
      busy = false;
    }
  }

  /** A ilha se escondeu: o Nimboo surge de um canto inferior. */
  async function goAway(): Promise<void> {
    if (mode !== 'island' || away || busy || window.isDestroyed()) return;
    const corner: 'left' | 'right' = lastCorner === 'left' ? 'right' : 'left'; // alterna os cantos
    lastCorner = corner;
    const bounds = bottomCornerBounds(islandDisplay(), sizes().mochiSize, corner);
    away = true;
    islandOpen = false;
    awayAt = Date.now();
    edgeSince = null;
    await transition(() => layoutFloating(bounds), {
      mode: 'floating',
      entrance: { kind: 'slide', from: corner },
    });
    hiding = false;
    showEdgeHint(0); // com o Nimboo no canto, a linha mostra por onde a ilha volta (já está à vista)
  }

  /** Traz a ilha de volta: o Nimboo sai de cena e a ilha desce do topo. */
  async function showIsland(): Promise<void> {
    if (!away || busy || window.isDestroyed()) return;
    busy = true; // a linha segue à vista: a ilha vai surgir dela (esmaece ao começar a entrada)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, LEAVE_TIMEOUT_MS);
      leaveAck = () => {
        clearTimeout(timer);
        resolve();
      };
      window.webContents.send(IPC.leave);
    });
    leaveAck = null;
    busy = false;
    away = false;
    // A entrada (a ilha crescendo a partir da linha) começa quando o layout é confirmado,
    // que é o momento em que `transition` resolve: aí a linha esmaece.
    await transition(layoutIsland, { mode: 'island', entrance: { kind: 'drop' } });
    fadeOutEdgeHint();
  }

  /** O renderer mostra/oculta um balão de fala: a forma da ilha recolhida inclui a área dele. */
  const onBubbleVisible = (event: Electron.IpcMainEvent, visible: unknown) => {
    if (!fromWindow(event)) return;
    const next = visible === true && presentationMode() === 'island';
    if (next === bubbleVisible) return;
    bubbleVisible = next;
    if (presentationMode() === 'island' && !busy) window.setShape(shapesNow());
  };
  ipcMain.on(IPC.bubbleVisible, onBubbleVisible);

  /** Reaplica tamanhos e posição (depois de mudar o tamanho da ilha ou do Nimboo nas preferências). */
  function refreshLayout(): void {
    if (window.isDestroyed() || busy) return;
    if (presentationMode() === 'island') {
      window.setBounds(islandRect());
      window.setShape(shapesNow());
      return;
    }
    const size = sizes().mochiSize;
    const current = window.getBounds();
    let target: Rect;
    if (away) {
      target = bottomCornerBounds(islandDisplay(), size, lastCorner);
    } else {
      const placed = floatingBounds({ x: current.x, y: current.y }, size, allDisplays(), primaryId());
      target = clampRectToArea(placed, pickDisplayForRect(placed, allDisplays(), primaryId()).workArea);
      baseline = target;
    }
    window.setBounds(target);
    window.setShape([{ x: 0, y: 0, width: target.width, height: target.height }]);
  }

  /** Atalho global: traz o mascote e pede à ilha para abrir direto nas tarefas. */
  async function summon(): Promise<void> {
    if (window.isDestroyed() || mode !== 'island') return;
    if (!window.isVisible()) window.show();
    if (away) await showIsland();
    if (!window.isDestroyed()) window.webContents.send(IPC.islandSummon);
  }

  async function setMode(next: PresentationMode): Promise<void> {
    if (busy || window.isDestroyed() || next === mode) return;
    hideEdgeHint();
    if (next === 'island') {
      persistPosition(); // lembra onde o mascote estava para voltar depois
      const display = pickDisplayForRect(window.getBounds(), allDisplays(), primaryId());
      settings.update({ mode: 'island', displayId: display.id });
      mode = 'island';
      away = false;
      await transition(layoutIsland, { mode: 'island', entrance: { kind: 'drop' } });
      return;
    }
    // Fixar o mascote solto.
    const wasAway = away;
    settings.update({ mode: 'floating' });
    mode = 'floating';
    away = false;
    if (wasAway) {
      // Ele já está solto no canto: fica onde está.
      const [x, y] = window.getPosition();
      baseline = window.getBounds();
      settings.update({ floating: { x, y } });
      return;
    }
    const target = floatingTarget();
    baseline = target;
    await transition(() => layoutFloating(target), { mode: 'floating', entrance: null });
  }

  return {
    window,
    getMode: () => mode,
    getPresentation: presentationMode,
    isAway: () => away,
    isIslandOpen: () => islandOpen,
    refreshLayout,
    getScales: () => {
      const s = sizes();
      return { islandScale: s.islandScale, mochiScale: s.mochiSize / MASCOT_SIZE };
    },
    summon,
    setMode,
    toggleMode: () => setMode(mode === 'floating' ? 'island' : 'floating'),
    showIsland,
    requestIslandToggle: () => {
      if (presentationMode() === 'island' && !window.isDestroyed()) window.webContents.send(IPC.islandToggle);
    },
    onCursor(point) {
      if (!away || busy || Date.now() - awayAt < AWAY_COOLDOWN_MS) {
        edgeSince = null;
        return;
      }
      const bounds = islandDisplay().bounds;
      const centerX = bounds.x + bounds.width / 2;
      const inZone = point.y <= bounds.y + 1 && Math.abs(point.x - centerX) <= REVEAL_HALF_WIDTH;
      if (!inZone) {
        edgeSince = null;
        return;
      }
      const now = Date.now();
      edgeSince ??= now;
      if (now - edgeSince >= REVEAL_DWELL_MS) {
        edgeSince = null;
        void showIsland();
      }
    },
    dispose() {
      screen.removeListener('display-removed', onDisplayChange);
      screen.removeListener('display-metrics-changed', onDisplayChange);
      ipcMain.removeHandler(IPC.getPresentation);
      ipcMain.removeHandler(IPC.islandOpen);
      ipcMain.removeHandler(IPC.islandExtent);
      ipcMain.removeListener(IPC.presentationApplied, onApplied);
      ipcMain.removeListener(IPC.islandClosed, onIslandClosed);
      ipcMain.removeListener(IPC.islandHidden, onIslandHidden);
      ipcMain.removeListener(IPC.islandHiding, onIslandHiding);
      ipcMain.removeListener(IPC.bubbleVisible, onBubbleVisible);
      ipcMain.removeListener(IPC.leaveDone, onLeaveDone);
      hideEdgeHint();
      if (edgeHint && !edgeHint.isDestroyed()) edgeHint.destroy();
      persistPosition();
      settings.flush();
    },
  };
}
