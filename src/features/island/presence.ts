import type { Entrance } from '../../../shared/presentation';

/** Distância de "fora de cena": a janela recorta tudo que passa da borda. */
const OFFSCREEN = '120%';

export type ExitDirection = 'up' | 'left' | 'right';

/** Transformação inicial da entrada (fora de cena), ou `null` se não há entrada. */
export function entranceFrom(entrance: Entrance): string | null {
  if (!entrance) return null;
  if (entrance.kind === 'drop') return `translateY(-${OFFSCREEN})`;
  return `translateX(${entrance.from === 'left' ? '-' : ''}${OFFSCREEN})`;
}

/**
 * Entrada: a ilha desce da borda superior; o Mochi surge pela lateral do canto.
 * Passa um pouco do ponto final e assenta (movimento com massa, sem exagero).
 */
export function playEntrance(el: HTMLElement, entrance: NonNullable<Entrance>): Animation {
  const from = entranceFrom(entrance) as string;
  const axis = entrance.kind === 'drop' ? 'Y' : 'X';
  const inward = entrance.kind === 'drop' ? 1 : entrance.from === 'left' ? 1 : -1;
  return el.animate(
    [
      { transform: from },
      { transform: `translate${axis}(${6 * inward}px)`, offset: 0.7 },
      { transform: 'translate(0, 0)' },
    ],
    {
      duration: entrance.kind === 'drop' ? 520 : 640,
      easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)',
      fill: 'both',
    },
  );
}

/** Saída: mais rápida que a entrada (~50%) e com aceleração. */
export function playExit(el: HTMLElement, direction: ExitDirection): Animation {
  const to = direction === 'up' ? `translateY(-${OFFSCREEN})` : `translateX(${direction === 'left' ? '-' : ''}${OFFSCREEN})`;
  return el.animate([{ transform: 'translate(0, 0)' }, { transform: to }], {
    duration: 260,
    easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)',
    fill: 'both',
  });
}
