import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  clearTurns,
  initialPhysics,
  isDizzy,
  isSettled,
  stepPhysics,
  type PhysicsState,
} from './dragPhysics';

/** Enjoou de novo só depois deste intervalo (ms), para não ficar preso num ciclo de enjoo. */
const DIZZY_COOLDOWN_MS = 7000;
/** Teto da aceleração usada (px/s²): evita um "pico" de leitura virar uma explosão de giro. */
const MAX_ACCEL = 60000;

interface Options {
  svgRef: RefObject<SVGSVGElement | null>;
  /** Girou demais: o mascote fica enjoado. */
  onDizzy: () => void;
}

/**
 * Liga a física do arraste ao SVG: lê o movimento horizontal do cursor a cada quadro, avança o
 * pêndulo e escreve `--drag-rot` no SVG (sem re-render do React). O laço só roda enquanto o Mochi está
 * sendo segurado ou ainda balançando/girando.
 */
export function useDragPhysics({ svgRef, onDizzy }: Options) {
  const physics = useRef<PhysicsState>(initialPhysics());
  const held = useRef(false);
  const pointerX = useRef<number | null>(null);
  const sample = useRef<{ x: number; t: number; v: number } | null>(null);
  const accel = useRef(0);
  const lastFrame = useRef(0);
  const lastDizzy = useRef(-Infinity);
  const raf = useRef(0);
  const onDizzyRef = useRef(onDizzy);
  onDizzyRef.current = onDizzy;

  const setRotation = useCallback(
    (deg: number) => {
      svgRef.current?.style.setProperty('--drag-rot', `${deg.toFixed(2)}deg`);
    },
    [svgRef],
  );

  const frame = useCallback(
    (ts: number) => {
      const dt = lastFrame.current ? (ts - lastFrame.current) / 1000 : 1 / 60;
      lastFrame.current = ts;

      // Aceleração horizontal do cursor (suavizada) a partir da posição amostrada neste quadro.
      if (held.current && pointerX.current !== null) {
        const x = pointerX.current;
        const prev = sample.current;
        if (prev && dt > 0) {
          const v = (x - prev.x) / dt;
          const a = (v - prev.v) / dt;
          accel.current = accel.current * 0.6 + Math.max(-MAX_ACCEL, Math.min(MAX_ACCEL, a)) * 0.4;
          sample.current = { x, t: ts, v };
        } else {
          sample.current = { x, t: ts, v: 0 };
        }
      } else {
        accel.current *= 0.5;
        sample.current = null;
      }

      let next = stepPhysics(physics.current, held.current ? accel.current : 0, dt, ts / 1000);
      if (isDizzy(next, ts / 1000) && ts - lastDizzy.current > DIZZY_COOLDOWN_MS) {
        lastDizzy.current = ts;
        next = clearTurns(next);
        onDizzyRef.current();
      }
      physics.current = next;
      setRotation(next.angle);

      if (!held.current && isSettled(next)) {
        physics.current = initialPhysics();
        setRotation(0);
        raf.current = 0;
        lastFrame.current = 0;
        return;
      }
      raf.current = requestAnimationFrame(frame);
    },
    [setRotation],
  );

  const ensureRunning = useCallback(() => {
    if (raf.current === 0) {
      lastFrame.current = 0;
      raf.current = requestAnimationFrame(frame);
    }
  }, [frame]);

  /** O arraste começou. */
  const begin = useCallback(
    (screenX: number) => {
      held.current = true;
      pointerX.current = screenX;
      sample.current = null;
      accel.current = 0;
      ensureRunning();
    },
    [ensureRunning],
  );

  /** O cursor se moveu (coordenada de tela, para independer de a janela andar junto). */
  const move = useCallback((screenX: number) => {
    pointerX.current = screenX;
  }, []);

  /** Soltou: continua balançando/girando até assentar. */
  const end = useCallback(() => {
    held.current = false;
    pointerX.current = null;
    ensureRunning();
  }, [ensureRunning]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  return { begin, move, end };
}
