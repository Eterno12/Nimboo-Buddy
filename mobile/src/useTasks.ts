import { useCallback, useEffect, useRef, useState } from 'react';
import type { Task } from '../../shared/tasks';
import type { Core } from './core';

const UNDO_MS = 5000;

export interface PendingRemoval {
  task: Task;
  /** Subtarefas que somem junto. */
  count: number;
}

/**
 * Tarefas na interface: lista viva do banco local + exclusão com "Desfazer" (a tarefa só é apagada de
 * verdade depois de 5 s; se o app fechar antes, a exclusão é cancelada, igual ao PC).
 */
export function useTasks(core: Core) {
  const [active, setActive] = useState<Task[]>([]);
  const [completed, setCompleted] = useState<Task[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  const load = useCallback(async () => {
    const lists = await core.tasks.list();
    setActive(lists.active);
    setCompleted(lists.completed);
  }, [core]);

  useEffect(() => {
    void load();
    return core.subscribe(() => void load());
  }, [core, load]);

  const finalize = useCallback(
    async (ids: string[]) => {
      for (const id of ids) await core.tasks.remove(id);
      setHidden((h) => {
        const next = new Set(h);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    },
    [core],
  );

  const remove = useCallback(
    (task: Task) => {
      // Uma exclusão anterior ainda no prazo vira definitiva agora.
      if (timer.current) clearTimeout(timer.current);
      const before = [...hiddenRef.current];
      if (before.length > 0) void finalize(before);
      const ids = [task.id, ...active.filter((t) => t.parentId === task.id).map((t) => t.id)];
      setHidden(new Set(ids));
      setPending({ task, count: ids.length - 1 });
      timer.current = setTimeout(() => {
        setPending(null);
        void finalize(ids);
      }, UNDO_MS);
    },
    [active, finalize],
  );

  const undo = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHidden(new Set());
    setPending(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const visible = (list: Task[]) => list.filter((t) => !hidden.has(t.id));
  return { active: visible(active), completed: visible(completed), pending, remove, undo, reload: load };
}
