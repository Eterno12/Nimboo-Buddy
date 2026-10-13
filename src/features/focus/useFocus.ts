import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDLE_FOCUS_STATE,
  type FocusKind,
  type FocusResult,
  type FocusState,
} from '../../../shared/focus';

/**
 * Estado do modo foco na interface. O relógio vive no processo principal: este hook
 * só guarda uma cópia (que muda a cada início/pausa/fim, não a cada segundo) e a
 * mantém igual entre janelas. Quem precisa do restante usa `useNow` + `remainingNow`.
 */
export function useFocus() {
  const [state, setState] = useState<FocusState>(IDLE_FOCUS_STATE);
  const changed = useRef(false);

  useEffect(() => {
    let alive = true;
    const off = window.mochi.focus.onChange((next) => {
      changed.current = true; // um aviso mais novo que a leitura inicial vence
      if (alive) setState(next);
    });
    void window.mochi.focus.getState().then((initial) => {
      if (alive && initial && !changed.current) setState(initial);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  /** O estado do retorno já chega pelo aviso de mudança; aqui só se devolve o resultado. */
  const run = useCallback(async (op: () => Promise<FocusResult<FocusState>>) => op(), []);
  const api = window.mochi.focus;

  return {
    state,
    start: (kind: FocusKind, minutes: number) => run(() => api.start(kind, minutes)),
    pause: () => run(() => api.pause()),
    resume: () => run(() => api.resume()),
    cancel: () => run(() => api.cancel()),
  };
}

export type FocusController = ReturnType<typeof useFocus>;

/** Relógio da interface: atualiza só enquanto `active` (uma sessão correndo e visível). */
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
