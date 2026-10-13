import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Entrance, PresentationState } from '../../../shared/presentation';
import { entranceFrom, playEntrance, playExit } from './presence';

interface Presentation extends PresentationState {
  /** Incrementa a cada apresentação recebida (mesmo que o conteúdo se repita). */
  token: number;
}

interface PresenceOptions {
  /** A entrada terminou (ou não havia entrada) e o layout já está à vista. */
  onShown(state: PresentationState): void;
}

/**
 * Presença do mascote na janela: recebe a apresentação do main, desenha o
 * layout, confirma, e toca a animação de entrada/saída no elemento `presenceRef`.
 * Tudo é imperativo (Web Animations) para não remontar o mascote.
 */
export function usePresence({ onShown }: PresenceOptions) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const presenceRef = useRef<HTMLDivElement | null>(null);
  const side = useRef<'left' | 'right'>('right');
  const shown = useRef(onShown);
  shown.current = onShown;

  useEffect(() => {
    let alive = true;
    let token = 0;
    void window.mochi.getPresentation().then((p) => alive && setPresentation({ ...p, token: ++token }));
    const off = window.mochi.onPresentationChange((p) => setPresentation({ ...p, token: ++token }));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Antes de pintar: deixa o conteúdo fora de cena, pronto para entrar.
  useLayoutEffect(() => {
    const el = presenceRef.current;
    if (!el || !presentation) return;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = entranceFrom(presentation.entrance) ?? '';
    if (presentation.entrance?.kind === 'slide') side.current = presentation.entrance.from;
  }, [presentation]);

  // Depois do layout: confirma ao main (que revela a janela) e anima a entrada.
  useEffect(() => {
    if (!presentation) return;
    let second = 0;
    let animation: Animation | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        window.mochi.presentationApplied();
        const el = presenceRef.current;
        const entrance: Entrance = presentation.entrance;
        const done = () => shown.current({ mode: presentation.mode, entrance });
        if (el && entrance) {
          animation = playEntrance(el, entrance);
          animation.finished
            .then(() => {
              animation?.cancel();
              el.style.transform = '';
              done();
            })
            .catch(() => {});
        } else {
          done();
        }
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [presentation]);

  // O main pede para sair de cena (a ilha vai voltar): sai pela lateral de onde entrou.
  useEffect(() => {
    return window.mochi.onLeave(() => {
      const el = presenceRef.current;
      if (!el) {
        window.mochi.leaveDone();
        return;
      }
      playExit(el, side.current).finished.then(
        () => window.mochi.leaveDone(),
        () => window.mochi.leaveDone(),
      );
    });
  }, []);

  /** A ilha sobe e se esconde; resolve quando já saiu de cena. */
  const exitUp = useCallback(async () => {
    const el = presenceRef.current;
    if (el) await playExit(el, 'up').finished.catch(() => {});
  }, []);

  return { presentation, presenceRef, exitUp };
}
