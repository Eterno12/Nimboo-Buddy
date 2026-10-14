import { useEffect, useState } from 'react';
import type { BondSnapshot } from '../../../shared/achievements';

/** Vínculo e conquistas: leitura inicial + atualizações do processo principal. */
export function useBond(): BondSnapshot | null {
  const [snapshot, setSnapshot] = useState<BondSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    let changed = false;
    const off = window.mochi.bond.onChange((next) => {
      changed = true;
      if (alive) setSnapshot(next);
    });
    void window.mochi.bond
      .get()
      .then((initial) => {
        if (alive && !changed && initial) setSnapshot(initial);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return snapshot;
}
