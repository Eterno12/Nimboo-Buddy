import { ipcMain, screen, type BrowserWindow, type Display } from 'electron';
import { IPC } from '../shared/ipc';
import {
  bottomCornerBounds,
  floatingBounds,
  islandBounds,
  pickDisplayForRect,
  resolveIslandDisplay,
  type DisplayInfo,
  type Rect,
} from '../shared/geometry';
import {
  ISLAND_WINDOW_SIZE,
  islandShape,
  type Entrance,
  type IslandExtent,
  type PresentationState,
} from '../shared/presentation';
import type { PresentationMode } from '../shared/settings';
import { createMascotWindow, MASCOT_SIZE } from './windows';
import type { SettingsStore } from './settingsStore';

const toInfo = (d: Display): DisplayInfo => ({ id: d.id, bounds: d.bounds, workArea: d.workArea });
const allDisplays = (): DisplayInfo[] => screen.getAllDisplays().map(toInfo);
const primaryId = (): number => screen.getPrimaryDisplay().id;

/** Tempo máximo que uma troca espera o renderer desenhar o novo layout. */
const APPLY_ACK_TIMEOUT_MS = 300;
/** Tempo máximo que a volta à ilha espera a animação de saída do Mochi. */
const LEAVE_TIMEOUT_MS = 500;
/** Revelar a ilha: cursor na borda superior, perto do centro, por este tempo. */
const REVEAL_DWELL_MS = 250;
const REVEAL_HALF_WIDTH = 140;
/** Depois que o Mochi surge no canto, ignora a borda por um instante. */
const AWAY_COOLDOWN_MS = 1500;

export interface WindowModeManager {
  readonly window: BrowserWindow;
  /** Modo preferido (o que fica salvo). */
  getMode(): PresentationMode;
  /** Layout em uso agora: `island` só com a ilha à vista; o Mochi no canto é `floating`. */
  getPresentation(): PresentationMode;
  /** O modo preferido é a ilha, mas ela está escondida e o Mochi está no canto. */
  isAway(): boolean;
  isIslandOpen(): boolean;
  setMode(mode: PresentationMode): Promise<void>;
  toggleMode(): Promise<void>;
  /** Traz a ilha de volta (a partir do Mochi no canto). */
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
 *  - flutuante: janela 240x240 solta; no modo ilha, o Mochi "fora da ilha"
 *    também usa este layout, num canto inferior, enquanto a ilha está escondida.
 */
export function createWindowModeManager(settings: SettingsStore): WindowModeManager {
  let mode: PresentationMode = settings.get().mode;
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

  const islandDisplay = (): DisplayInfo =>
    resolveIslandDisplay(settings.get().displayId, allDisplays(), primaryId());
  const islandRect = (): Rect => islandBounds(islandDisplay(), ISLAND_WINDOW_SIZE);
  const floatingTarget = (): Rect => {
    const s = settings.get();
    return floatingBounds(s.floating, MASCOT_SIZE, allDisplays(), primaryId(), s.displayId);
  };

  const presentationMode = (): PresentationMode => (mode === 'island' && !away ? 'island' : 'floating');

  // Última posição flutuante "padrão" aplicada; serve para não fixá-la sem o usuário mover.
  let baseline: Rect = mode === 'floating' ? floatingTarget() : { x: 0, y: 0, width: 0, height: 0 };
  const initial = mode === 'island' ? islandRect() : baseline;
  const window = createMascotWindow(initial, { focusable: mode === 'floating' });
  if (mode === 'island') window.setShape([islandShape(false)]);

  /** Layouts: cada um troca tamanho, forma e foco de uma vez. */
  const layoutIsland = () => {
    islandOpen = false;
    islandExtent = 'home';
    window.setFocusable(false);
    window.setBounds(islandRect());
    window.setShape([islandShape(false)]);
  };
  const layoutFloating = (bounds: Rect) => {
    window.setFocusable(true);
    window.setBounds(bounds);
    // Forma vazia desligaria a janela inteira; "sem forma" é o retângulo todo.
    window.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }]);
  };

  /**
   * Guarda a posição flutuante só se o usuário a mudou: o evento 'move' também
   * dispara no posicionamento inicial. Na ilha e no Mochi do canto (temporário)
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
    window.setShape([islandShape(true, 'home')]);
    window.setFocusable(true);
    window.focus();
  });
  /** Ajusta a forma da ilha aberta à tela atual (maior antes de crescer, menor depois de encolher). */
  ipcMain.handle(IPC.islandExtent, (event, extent: unknown) => {
    if (!fromWindow(event)) throw new Error('Remetente não autorizado');
    if (extent !== 'home' && extent !== 'tasks') return;
    if (presentationMode() !== 'island' || busy || !islandOpen) return;
    islandExtent = extent;
    window.setShape([islandShape(true, islandExtent)]);
  });
  /** Volta à forma compacta depois da animação de recolher e libera o foco. */
  const onIslandClosed = (event: Electron.IpcMainEvent) => {
    if (!fromWindow(event) || presentationMode() !== 'island' || !islandOpen) return;
    islandOpen = false;
    islandExtent = 'home';
    window.setFocusable(false);
    window.setShape([islandShape(false)]);
  };
  ipcMain.on(IPC.islandClosed, onIslandClosed);

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

  /** A ilha se escondeu: o Mochi surge de um canto inferior. */
  async function goAway(): Promise<void> {
    if (mode !== 'island' || away || busy || window.isDestroyed()) return;
    const corner: 'left' | 'right' = lastCorner === 'left' ? 'right' : 'left'; // alterna os cantos
    lastCorner = corner;
    const bounds = bottomCornerBounds(islandDisplay(), MASCOT_SIZE, corner);
    away = true;
    islandOpen = false;
    awayAt = Date.now();
    edgeSince = null;
    await transition(() => layoutFloating(bounds), {
      mode: 'floating',
      entrance: { kind: 'slide', from: corner },
    });
  }

  /** Traz a ilha de volta: o Mochi sai de cena e a ilha desce do topo. */
  async function showIsland(): Promise<void> {
    if (!away || busy || window.isDestroyed()) return;
    busy = true;
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
    await transition(layoutIsland, { mode: 'island', entrance: { kind: 'drop' } });
  }

  async function setMode(next: PresentationMode): Promise<void> {
    if (busy || window.isDestroyed() || next === mode) return;
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
      ipcMain.removeListener(IPC.leaveDone, onLeaveDone);
      persistPosition();
      settings.flush();
    },
  };
}
