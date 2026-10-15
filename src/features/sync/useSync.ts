import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_SYNC, type SyncResultMessage, type SyncState } from '../../../shared/sync/state';

/** Conta e sincronização na interface: cópia do estado do processo principal (nunca tokens). */
export function useSync() {
  const [state, setState] = useState<SyncState>(EMPTY_SYNC);
  const [busy, setBusy] = useState(false);
  const changed = useRef(false);

  useEffect(() => {
    let alive = true;
    const off = window.mochi.sync.onChange((next) => {
      changed.current = true;
      if (alive) setState(next);
    });
    void window.mochi.sync.get().then((initial) => {
      if (alive && !changed.current) setState(initial);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  const requestCode = useCallback((email: string): Promise<SyncResultMessage> => run(() => window.mochi.sync.requestCode(email)), [run]);
  const verify = useCallback(
    async (email: string, code: string): Promise<SyncResultMessage> => {
      const r = await run(() => window.mochi.sync.verify(email, code));
      if (r.ok) setState(await window.mochi.sync.get());
      return r;
    },
    [run],
  );
  const syncNow = useCallback(async () => {
    const next = await run(() => window.mochi.sync.now());
    if (next) setState(next);
  }, [run]);
  const signOut = useCallback(async () => {
    const next = await run(() => window.mochi.sync.signOut());
    if (next) setState(next);
  }, [run]);
  const wipeCloud = useCallback((): Promise<SyncResultMessage> => run(() => window.mochi.sync.wipeCloud()), [run]);

  return { state, busy, requestCode, verify, syncNow, signOut, wipeCloud };
}
