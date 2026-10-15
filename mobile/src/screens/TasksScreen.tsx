import { useMemo, useState } from 'react';
import type { Task } from '../../../shared/tasks';
import { TaskRow } from '../ui/TaskRow';
import { Icon } from '../ui/Icon';

interface Props {
  active: Task[];
  completed: Task[];
  onToggle(task: Task): void;
  onOpen(task: Task): void;
  onAdd(): void;
}

/** Lista de tarefas: ativas (com subtarefas agrupadas) e concluídas. */
export function TasksScreen({ active, completed, onToggle, onOpen, onAdd }: Props) {
  const [tab, setTab] = useState<'active' | 'done'>('active');
  const now = new Date();

  const { mains, children } = useMemo(() => {
    const kids = new Map<string, Task[]>();
    for (const t of [...active, ...completed]) {
      if (t.parentId) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t]);
    }
    return { mains: active.filter((t) => t.parentId === null), children: kids };
  }, [active, completed]);

  const done = completed.filter((t) => t.parentId === null);
  const list = tab === 'active' ? mains : done;

  return (
    <div className="screen" data-testid="screen-tasks">
      <header className="screen-head">
        <h1>Tarefas</h1>
      </header>
      <div className="segmented wide" role="tablist" aria-label="Filtro">
        <button type="button" role="tab" aria-selected={tab === 'active'} onClick={() => setTab('active')} data-testid="filter-active">
          Ativas ({mains.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'done'} onClick={() => setTab('done')} data-testid="filter-done">
          Concluídas ({done.length})
        </button>
      </div>

      <ul className="task-list" data-testid="tasks">
        {list.map((t) => (
          <TaskRow key={t.id} task={t} subtasks={children.get(t.id) ?? []} now={now} onToggle={onToggle} onOpen={onOpen} />
        ))}
      </ul>
      {list.length === 0 && (
        <div className="empty-card">
          <p>{tab === 'active' ? 'Nenhuma tarefa ativa. Que tal criar uma?' : 'Nada concluído ainda (as concluídas ficam 30 dias).'}</p>
        </div>
      )}

      <button type="button" className="fab" aria-label="Nova tarefa" data-testid="fab-add" onClick={onAdd}>
        <Icon name="plus" size={26} />
      </button>
    </div>
  );
}
