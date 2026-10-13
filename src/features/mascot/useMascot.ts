import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createMascotController,
  type CursorSample,
  type MascotController,
  type MascotSnapshot,
} from './mascotController';

const INITIAL: MascotSnapshot = { state: 'idle', replay: 0, hop: false, blinking: false, mood: 'mid' };

/** Liga a máquina de estados do mascote ao React. */
export function useMascot() {
  const [snapshot, setSnapshot] = useState<MascotSnapshot>(INITIAL);
  const ref = useRef<MascotController | null>(null);

  useEffect(() => {
    const controller = createMascotController(setSnapshot);
    ref.current = controller;
    controller.start();
    return () => {
      controller.dispose();
      ref.current = null;
    };
  }, []);

  const actions = useMemo(
    () => ({
      pet: () => ref.current?.pet(),
      celebrate: () => ref.current?.celebrate(),
      greet: () => ref.current?.greet(),
      hoverChange: (h: boolean) => ref.current?.hoverChange(h),
      cursor: (s: CursorSample) => ref.current?.cursor(s),
      activity: () => ref.current?.activity(),
      grab: () => ref.current?.grab(),
      release: () => ref.current?.release(),
      endHop: () => ref.current?.endHop(),
      setTraits: (t: Parameters<MascotController['setTraits']>[0]) => ref.current?.setTraits(t),
      debugSet: (s: Parameters<MascotController['debugSet']>[0]) => ref.current?.debugSet(s),
    }),
    [],
  );

  return { ...snapshot, ...actions };
}
