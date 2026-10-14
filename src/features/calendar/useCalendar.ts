import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_CALENDAR, type CalendarResult, type CalendarState } from '../../../shared/calendar';

/**
 * Agenda na interface: uma cópia do estado do processo principal (que baixa e guarda tudo). O
 * endereço da agenda nunca chega aqui: só `configured`, o domínio e os eventos.
 */
export function useCalendar() {
  const [state, setState] = useState<CalendarState>(EMPTY_CALENDAR);
  const [busy, setBusy] = useState(false);
  const changed = useRef(false);

  useEffect(() => {
    let alive = true;
    const off = window.mochi.calendar.onChange((next) => {
      changed.current = true;
      if (alive) setState(next);
    });
    void window.mochi.calendar.get().then((initial) => {
      if (alive && !changed.current) setState(initial);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const setUrl = useCallback(async (url: string): Promise<CalendarResult<CalendarState>> => {
    setBusy(true);
    try {
      const result = await window.mochi.calendar.setUrl(url);
      if (result.ok) setState(result.value);
      return result;
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = useCallback(async () => {
    setBusy(true);
    try {
      setState(await window.mochi.calendar.clear());
    } finally {
      setBusy(false);
    }
  }, []);

  const remove = useCallback(async (slot: number) => {
    setBusy(true);
    try {
      setState(await window.mochi.calendar.remove(slot));
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setState(await window.mochi.calendar.refresh());
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, setUrl, clear, remove, refresh };
}
