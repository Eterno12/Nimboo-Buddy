import type { Entrance } from '../../../shared/presentation';

/** Distância de "fora de cena" lateral: a janela recorta tudo que passa da borda. */
const OFFSCREEN = '120%';

export type ExitDirection = 'up' | 'left' | 'right';

/**
 * A ilha nasce de, e some numa, linha fina no topo da tela (a linha-dica da borda).
 * "Linha" = a pílula achatada: quase sem altura e esticada na horizontal, com origem no
 * topo central. Só `transform` e `opacity` são animados (compositor, sem layout).
 * Acompanha `.presence { transform-origin: 50% 0 }` em island.css.
 */
const FLAT = 'scale(1.75, 0.035)';
const FLAT_MID = 'scale(1.32, 0.22)';

/** Estado inicial (antes de pintar) da entrada, ou `null` se a entrada não o usa. */
export function entranceStart(entrance: Entrance): { transform: string; opacity: string } | null {
  if (!entrance) return null;
  if (entrance.kind === 'drop') return { transform: FLAT, opacity: '0' };
  return { transform: `translateX(${entrance.from === 'left' ? '-' : ''}${OFFSCREEN})`, opacity: '' };
}

/**
 * Entrada. Ilha: cresce a partir da linha (ease-out, com um assentar curtinho na altura,
 * o "peso" do movimento). Mochi: surge pela lateral do canto e assenta (passa ~6px do ponto).
 */
export function playEntrance(el: HTMLElement, entrance: NonNullable<Entrance>): Animation {
  if (entrance.kind === 'drop') {
    return el.animate(
      [
        // 1) a linha "acende" e engrossa; 2) a ilha cresce (ease-out suave); 3) assenta no tamanho.
        { transform: FLAT, opacity: 0, easing: 'cubic-bezier(0.25, 0, 0.4, 1)' },
        { transform: 'scale(1.55, 0.07)', opacity: 1, offset: 0.14, easing: 'cubic-bezier(0.33, 0.9, 0.5, 1)' },
        { transform: 'scale(0.995, 1.035)', opacity: 1, offset: 0.72, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
        { transform: 'scale(1, 1)', opacity: 1 },
      ],
      { duration: 560, fill: 'both' },
    );
  }
  const from = entrance.from === 'left' ? '-' : '';
  const inward = entrance.from === 'left' ? 1 : -1;
  return el.animate(
    [
      { transform: `translateX(${from}${OFFSCREEN})` },
      { transform: `translateX(${6 * inward}px)`, offset: 0.7 },
      { transform: 'translate(0, 0)' },
    ],
    { duration: 640, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)', fill: 'both' },
  );
}

/**
 * Saída (mais curta que a entrada, ease-in: "puxa" para a linha). A ilha achata até virar
 * a linha e some; o Mochi sai pela lateral.
 */
export function playExit(el: HTMLElement, direction: ExitDirection): Animation {
  if (direction === 'up') {
    return el.animate(
      [
        { transform: 'scale(1, 1)', opacity: 1, easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)' },
        { transform: 'scale(1.04, 0.9)', opacity: 1, offset: 0.12, easing: 'cubic-bezier(0.4, 0, 0.8, 0.6)' },
        { transform: FLAT_MID, opacity: 0.9, offset: 0.6, easing: 'cubic-bezier(0.3, 0, 0.7, 1)' },
        { transform: FLAT, opacity: 0 },
      ],
      { duration: 340, fill: 'both' },
    );
  }
  const to = `translateX(${direction === 'left' ? '-' : ''}${OFFSCREEN})`;
  return el.animate([{ transform: 'translate(0, 0)' }, { transform: to }], {
    duration: 260,
    easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)',
    fill: 'both',
  });
}
