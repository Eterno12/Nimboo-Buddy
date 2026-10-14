import { useEffect, useState } from 'react';
import { EMPTY_MEDIA, type MediaState } from '../../../shared/media';

/** O que está tocando no Windows (vem do processo principal; vazio com o player desligado). */
export function useMedia(): MediaState {
  const [state, setState] = useState<MediaState>(EMPTY_MEDIA);

  useEffect(() => {
    let alive = true;
    let changed = false;
    const off = window.mochi.media.onChange((next) => {
      changed = true;
      if (alive) setState(next);
    });
    void window.mochi.media
      .get()
      .then((initial) => {
        if (alive && !changed) setState(initial);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state;
}
