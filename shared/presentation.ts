import type { Rect, Size } from './geometry';
import type { PresentationMode } from './settings';

/**
 * A janela da ilha tem SEMPRE este tamanho (DIP); nunca é redimensionada.
 * Expandir/recolher e trocar de tela apenas mudam a forma da janela
 * (`setShape`), o que evita o quadro de transição em que o conteúdo aparecia
 * deslocado e deixa cliques na área transparente atravessarem a janela.
 * Precisa acompanhar `src/features/island/island.css` (folga de 8px nas
 * laterais e 10px embaixo ao redor da pílula):
 *  - recolhida: pílula 160x48;
 *  - expandida, tela inicial ("home"): pílula 336x164;
 *  - expandida, tela de tarefas: pílula 336x370.
 */
export const ISLAND_WINDOW_SIZE: Size = { width: 352, height: 380 };
export const ISLAND_COMPACT_SIZE: Size = { width: 176, height: 58 };
export const ISLAND_HOME_HEIGHT = 174;
/** Tela do modo foco: pílula 336x204 + folga (precisa acompanhar `island.css`). */
export const ISLAND_FOCUS_HEIGHT = 214;

/** Tela mostrada pela ilha expandida (define até onde a forma se estende). */
export type IslandExtent = 'home' | 'tasks' | 'focus';

/** Forma (em coordenadas da janela) da ilha recolhida ou expandida em cada tela. */
export function islandShape(open: boolean, extent: IslandExtent = 'home'): Rect {
  if (!open) {
    return {
      x: Math.round((ISLAND_WINDOW_SIZE.width - ISLAND_COMPACT_SIZE.width) / 2),
      y: 0,
      ...ISLAND_COMPACT_SIZE,
    };
  }
  return {
    x: 0,
    y: 0,
    width: ISLAND_WINDOW_SIZE.width,
    height:
      extent === 'tasks'
        ? ISLAND_WINDOW_SIZE.height
        : extent === 'focus'
          ? ISLAND_FOCUS_HEIGHT
          : ISLAND_HOME_HEIGHT,
  };
}

/** Como o mascote entra em cena depois de uma troca de apresentação. */
export type Entrance =
  | { kind: 'drop' } // a ilha desce da borda superior
  | { kind: 'slide'; from: 'left' | 'right' } // o Mochi surge pela lateral, no canto
  | null;

export interface PresentationState {
  /** Layout a desenhar. O Mochi "fora da ilha" também é `floating`. */
  mode: PresentationMode;
  entrance: Entrance;
}

/**
 * Zona de revelação da ilha: cursor no topo físico do monitor, até esta distância (DIP) do
 * centro. A linha-dica tem a largura exata da zona, para mostrar onde ela está.
 */
export const EDGE_REVEAL_HALF_WIDTH = 140;
/** Janela da linha-dica: largura da zona; altura = linha de 2px + brilho. */
export const EDGE_HINT_SIZE: Size = { width: EDGE_REVEAL_HALF_WIDTH * 2, height: 8 };
