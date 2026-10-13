import { useEffect, useMemo, useRef, useState } from 'react';
import type { PresentationMode } from '../../../shared/settings';
import { createIslandController, type IslandController } from './islandController';

interface UseIslandOptions {
  /** Anima a ilha saindo de cena; resolve quando já saiu. */
  exit(): Promise<void>;
}

/**
 * Liga o controlador da ilha ao React e às ações do usuário (Esc, perder o foco,
 * menu) e ao ciclo de presença (esconder depois de um tempo parada).
 */
export function useIsland(mode: PresentationMode | null, { exit }: UseIslandOptions) {
  const [open, setOpen] = useState(false);
  const ref = useRef<IslandController | null>(null);
  const exitRef = useRef(exit);
  exitRef.current = exit;

  useEffect(() => {
    const controller = createIslandController({
      openWindow: () => window.mochi.islandOpen(),
      closeWindow: () => window.mochi.islandClosed(),
      onVisualChange: setOpen,
      hide: () => {
        window.mochi.islandHiding(); // a linha-dica surge junto com o início da saída
        void exitRef.current().then(() => window.mochi.islandHidden());
      },
    });
    ref.current = controller;
    const offToggle = window.mochi.onIslandToggle(() => controller.toggle());
    return () => {
      offToggle();
      controller.dispose();
      ref.current = null;
    };
  }, []);

  // Fora do modo ilha (ou com ela escondida) não há o que expandir nem esconder.
  useEffect(() => {
    if (mode !== 'island') ref.current?.reset();
  }, [mode]);

  // Esc e perda de foco recolhem a ilha.
  useEffect(() => {
    if (mode !== 'island') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ref.current?.collapse();
      else ref.current?.activity();
    };
    const onBlur = () => ref.current?.collapse();
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [mode]);

  const actions = useMemo(
    () => ({
      toggle: () => ref.current?.toggle(),
      expand: () => ref.current?.expand(),
      activity: () => ref.current?.activity(),
      setHover: (h: boolean) => ref.current?.setHover(h),
      setHold: (h: boolean) => ref.current?.setHold(h),
      transitionEnded: () => ref.current?.transitionEnded(),
      /** A ilha está à vista: começa a contar o tempo para esconder. */
      resume: (graceMs: number) => ref.current?.resume(graceMs),
    }),
    [],
  );

  return { open, ...actions };
}
