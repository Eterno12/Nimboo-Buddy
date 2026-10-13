import { useCallback, useEffect, useState } from 'react';
import type { PendingRemoval, TaskSnapshot } from '../../../shared/tasks';

type Status = 'loading' | 'ready' | 'error';

const EMPTY: TaskSnapshot = { active: [], completed: [], pendingRemovals: [] };

/**
 * Tarefas na interface. O SQLite (no processo principal) é a fonte de verdade:
 * este hook só guarda uma cópia para desenhar e a recarrega sempre que o main
 * avisa que algo mudou (inclusive por ações feitas em outra janela).
 */
export function useTasks() {
  const [snapshot, setSnapshot] = useState<TaskSnapshot>(EMPTY);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await window.mochi.tasks.list();
    if (result.ok) {
      setSnapshot(result.value);
      setStatus('ready');
      setError(null);
    } else {
      setStatus('error');
      setError(result.error.message);
    }
  }, []);

  useEffect(() => {
    void reload();
    return window.mochi.tasks.onChange(() => void reload());
  }, [reload]);

  const api = window.mochi.tasks;
  return {
    active: snapshot.active,
    completed: snapshot.completed,
    pendingRemovals: snapshot.pendingRemovals as PendingRemoval[],
    status,
    error,
    reload,
    create: (title: string, dueAt?: string | null, sourceRef?: string | null) =>
      api.create(title, dueAt ?? null, sourceRef ?? null),
    setDue: (id: string, dueAt: string | null) => api.setDue(id, dueAt),
    complete: (id: string) => api.complete(id),
    reopen: (id: string) => api.reopen(id),
    scheduleRemove: (id: string) => api.scheduleRemove(id),
    undoRemove: (id: string) => api.undoRemove(id),
  };
}
