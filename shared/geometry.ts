/** Geometria pura (sem Electron), usada pelo main e pelos testes. Tudo em DIP. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  bounds: Rect;
  /** Área útil: já exclui a barra de tarefas. */
  workArea: Rect;
}

export interface Size {
  width: number;
  height: number;
}

/** Folga padrão do mascote flutuante em relação ao canto inferior direito. */
export const FLOATING_MARGIN = { right: 40, bottom: 20 } as const;

/** Fração mínima da janela que precisa estar visível para respeitar a posição salva. */
const MIN_VISIBLE_FRACTION = 0.5;

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Monitor com maior sobreposição com `rect`; se nenhum, o `fallbackId` ou o primeiro. */
export function pickDisplayForRect(rect: Rect, displays: readonly DisplayInfo[], fallbackId?: number): DisplayInfo {
  if (displays.length === 0) throw new Error('Nenhum monitor disponível');
  let best = displays[0];
  let bestArea = -1;
  for (const d of displays) {
    const area = intersectionArea(rect, d.bounds);
    if (area > bestArea) {
      best = d;
      bestArea = area;
    }
  }
  if (bestArea > 0) return best;
  return displays.find((d) => d.id === fallbackId) ?? displays[0];
}

/** Mantém `rect` inteiro dentro de `area` (ancorando no canto superior esquerdo se não couber). */
export function clampRectToArea(rect: Rect, area: Rect): Rect {
  const x = Math.min(Math.max(rect.x, area.x), Math.max(area.x, area.x + area.width - rect.width));
  const y = Math.min(Math.max(rect.y, area.y), Math.max(area.y, area.y + area.height - rect.height));
  return { ...rect, x: Math.round(x), y: Math.round(y) };
}

/**
 * Posição do mascote flutuante. Respeita a posição salva se pelo menos metade
 * da janela estiver visível em algum monitor; senão, canto inferior direito do
 * monitor preferido (ou do primário).
 */
export function floatingBounds(
  saved: { x: number; y: number } | null,
  size: number,
  displays: readonly DisplayInfo[],
  primaryId: number,
  preferredId?: number | null,
): Rect {
  if (saved) {
    const rect: Rect = { x: saved.x, y: saved.y, width: size, height: size };
    const visible = displays.some(
      (d) => intersectionArea(rect, d.workArea) >= size * size * MIN_VISIBLE_FRACTION,
    );
    if (visible) return rect;
  }
  const display =
    displays.find((d) => d.id === preferredId) ?? displays.find((d) => d.id === primaryId) ?? displays[0];
  const wa = display.workArea;
  return clampRectToArea(
    {
      x: wa.x + wa.width - size - FLOATING_MARGIN.right,
      y: wa.y + wa.height - size - FLOATING_MARGIN.bottom,
      width: size,
      height: size,
    },
    wa,
  );
}

/** Canto inferior (esquerdo ou direito) da área útil, rente às bordas. */
export function bottomCornerBounds(display: DisplayInfo, size: number, corner: 'left' | 'right'): Rect {
  const wa = display.workArea;
  return {
    x: corner === 'left' ? wa.x : wa.x + wa.width - size,
    y: wa.y + wa.height - size,
    width: size,
    height: size,
  };
}

/**
 * Linha-dica da borda superior: centralizada no TOPO FÍSICO do monitor (`bounds`, não a
 * área útil), que é onde o cursor precisa chegar para trazer a ilha de volta.
 */
export function edgeHintBounds(display: DisplayInfo, size: Size): Rect {
  const b = display.bounds;
  const width = Math.min(size.width, b.width);
  return { x: Math.round(b.x + (b.width - width) / 2), y: b.y, width, height: size.height };
}

/** Monitor da ilha: o preferido, se ainda existir; senão o primário. */
export function resolveIslandDisplay(
  preferredId: number | null | undefined,
  displays: readonly DisplayInfo[],
  primaryId: number,
): DisplayInfo {
  return displays.find((d) => d.id === preferredId) ?? displays.find((d) => d.id === primaryId) ?? displays[0];
}

/** Ilha: centralizada no topo da área útil do monitor (abaixo de uma barra de tarefas no topo). */
export function islandBounds(display: DisplayInfo, size: Size, topOffset = 0): Rect {
  const wa = display.workArea;
  const width = Math.min(size.width, wa.width);
  const height = Math.min(size.height, wa.height);
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + topOffset),
    width,
    height,
  };
}

/** Retângulo ampliado por um fator (valores inteiros, como o Windows exige para formas). */
export function scaleRect(rect: Rect, scale: number): Rect {
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  };
}

/** Tamanho ampliado por um fator. */
export function scaleSize(size: Size, scale: number): Size {
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

/**
 * Limita o fator pedido para que `base` ampliado caiba em `area` (monitor pequeno, escala alta
 * do Windows). Nunca devolve menos de 0,5.
 */
export function fitScale(scale: number, base: Size, area: Rect): number {
  const max = Math.min(area.width / base.width, area.height / base.height);
  return Math.max(0.5, Math.floor(Math.min(scale, max) * 100) / 100);
}