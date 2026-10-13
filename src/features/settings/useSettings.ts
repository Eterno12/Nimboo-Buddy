import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsSnapshot } from '../../../shared/ipc';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings';

const FALLBACK: SettingsSnapshot = {
  settings: { ...DEFAULT_SETTINGS },
  packaged: false,
  shortcutActive: false,
  effective: { islandScale: 1, mochiScale: 1 },
};

/**
 * Preferências na interface. O processo principal é a fonte de verdade: este hook guarda uma
 * cópia, aplica o que o main devolve e acompanha mudanças feitas em outra janela.
 */
export function useSettings() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>(FALLBACK);
  const [ready, setReady] = useState(false);
  const changed = useRef(false);

  useEffect(() => {
    let alive = true;
    const off = window.mochi.settings.onChange((next) => {
      changed.current = true; // um aviso mais novo vence a leitura inicial
      if (alive) {
        setSnapshot(next);
        setReady(true);
      }
    });
    void window.mochi.settings.get().then((initial) => {
      if (!alive || changed.current) return;
      setSnapshot(initial);
      setReady(true);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const update = useCallback(async (patch: Partial<Omit<Settings, 'version'>>) => {
    const next = await window.mochi.settings.update(patch);
    setSnapshot(next);
    return next;
  }, []);

  return { ...snapshot, ready, update };
}
