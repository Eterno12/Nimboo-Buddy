import { dueStatus, PRIORITY_LABEL, RECURRENCE_LABEL, type Task } from '../../../shared/tasks';
import { formatDue } from '../../../src/features/tasks/dueFormat';
import { Icon } from './Icon';

interface Props {
  task: Task;
  subtasks: Task[];
  now: Date;
  onToggle(task: Task): void;
  onOpen(task: Task): void;
}

/** Uma tarefa na lista: marcar, abrir para editar; mostra prazo, prioridade, repetição e subtarefas. */
export function TaskRow({ task, subtasks, now, onToggle, onOpen }: Props) {
  const status = dueStatus(task, now);
  const doneSubs = subtasks.filter((s) => s.completed).length;
  return (
    <li className="task-row" data-testid="task" data-done={task.completed} data-priority={task.priority}>
      <button
        type="button"
        className="task-check"
        data-done={task.completed}
        aria-label={task.completed ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
        aria-pressed={task.completed}
        onClick={() => onToggle(task)}
      >
        <Icon name="check" size={18} />
      </button>
      <button type="button" className="task-main" onClick={() => onOpen(task)} aria-label={`Editar ${task.title}`}>
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {task.dueAt && !task.completed && (
            <span className="chip-due" data-status={status}>
              <Icon name="clock" size={13} /> {formatDue(task.dueAt, now)}
            </span>
          )}
          {task.priority > 0 && !task.completed && (
            <span className="chip-prio" data-priority={task.priority}>
              {PRIORITY_LABEL[task.priority]}
            </span>
          )}
          {task.recurrence && (
            <span className="chip-soft" title={RECURRENCE_LABEL[task.recurrence]}>
              <Icon name="repeat" size={13} /> {RECURRENCE_LABEL[task.recurrence]}
            </span>
          )}
          {subtasks.length > 0 && (
            <span className="chip-soft">
              {doneSubs}/{subtasks.length}
            </span>
          )}
        </span>
      </button>
      <Icon name="chevron" size={18} />
    </li>
  );
}
