import { useState } from 'react';
import {
  PRIORITY_LABEL,
  RECURRENCE_LABEL,
  TASK_RECURRENCES,
  TASK_TITLE_MAX,
  titleLength,
  type Task,
  type TaskPriority,
  type TaskRecurrence,
} from '../../../shared/tasks';
import { fromLocalInputValue, presetDue, toLocalInputValue } from '../../../src/features/tasks/dueFormat';
import type { Core } from '../core';
import { playSound } from '../sound';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const PRIORITIES: TaskPriority[] = [0, 1, 2, 3];

interface FormState {
  title: string;
  due: string;
  priority: TaskPriority;
  recurrence: TaskRecurrence | '';
}

function Fields({ value, onChange }: { value: FormState; onChange(v: FormState): void }) {
  const over = titleLength(value.title) > TASK_TITLE_MAX;
  return (
    <>
      <label className="field">
        <span>Título</span>
        <input
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="O que precisa ser feito?"
          data-testid="field-title"
          aria-invalid={over}
          autoFocus
        />
        {over && <small className="field-error">Máximo de {TASK_TITLE_MAX} caracteres.</small>}
      </label>

      <div className="field">
        <span>Prazo</span>
        <input
          type="datetime-local"
          value={value.due}
          onChange={(e) => onChange({ ...value, due: e.target.value })}
          data-testid="field-due"
        />
        <div className="chips">
          <button type="button" className="chip-btn" onClick={() => onChange({ ...value, due: presetDue('today') })}>
            Hoje
          </button>
          <button type="button" className="chip-btn" onClick={() => onChange({ ...value, due: presetDue('tomorrow') })}>
            Amanhã
          </button>
          {value.due && (
            <button type="button" className="chip-btn" onClick={() => onChange({ ...value, due: '' })}>
              Sem prazo
            </button>
          )}
        </div>
      </div>

      <div className="field">
        <span>Prioridade</span>
        <div className="segmented" role="radiogroup" aria-label="Prioridade">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={value.priority === p}
              data-priority={p}
              onClick={() => onChange({ ...value, priority: p })}
            >
              {p === 0 ? 'Nenhuma' : PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Repetir</span>
        <select value={value.recurrence} onChange={(e) => onChange({ ...value, recurrence: e.target.value as TaskRecurrence | '' })}>
          <option value="">Não repete</option>
          {TASK_RECURRENCES.map((r) => (
            <option key={r} value={r}>
              {RECURRENCE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Folha "Nova tarefa". */
export function AddTaskSheet({ core, onClose }: { core: Core; onClose(): void }) {
  const [form, setForm] = useState<FormState>({ title: '', due: '', priority: 0, recurrence: '' });
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const r = await core.tasks.create(form.title, fromLocalInputValue(form.due), null, {
      priority: form.priority,
      recurrence: form.recurrence || null,
    });
    if (r.ok) {
      playSound('tick');
      onClose();
    } else setError(r.error.message);
  };

  return (
    <Sheet title="Nova tarefa" onClose={onClose}>
      <Fields value={form} onChange={setForm} />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn-primary" disabled={form.title.trim() === ''} data-testid="save-task" onClick={() => void save()}>
        Adicionar
      </button>
    </Sheet>
  );
}

interface EditProps {
  core: Core;
  task: Task;
  subtasks: Task[];
  onDelete(task: Task): void;
  onClose(): void;
}

/** Folha de edição: título, prazo, prioridade, repetição, subtarefas e exclusão. */
export function EditTaskSheet({ core, task, subtasks, onDelete, onClose }: EditProps) {
  const [form, setForm] = useState<FormState>({
    title: task.title,
    due: toLocalInputValue(task.dueAt),
    priority: task.priority,
    recurrence: task.recurrence ?? '',
  });
  const [sub, setSub] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (form.title.trim() !== task.title) {
      const r = await core.tasks.update(task.id, { title: form.title });
      if (!r.ok) return setError(r.error.message);
    }
    if (form.priority !== task.priority) await core.tasks.update(task.id, { priority: form.priority });
    if ((form.recurrence || null) !== task.recurrence && task.parentId === null) {
      const r = await core.tasks.update(task.id, { recurrence: form.recurrence || null });
      if (!r.ok) return setError(r.error.message);
    }
    const due = fromLocalInputValue(form.due);
    if (due !== task.dueAt) {
      const r = await core.tasks.setDue(task.id, due);
      if (!r.ok) return setError(r.error.message);
    }
    onClose();
  };

  const addSub = async () => {
    const t = sub.trim();
    if (!t) return;
    const r = await core.tasks.create(t, null, null, { parentId: task.id });
    if (r.ok) setSub('');
    else setError(r.error.message);
  };

  return (
    <Sheet title="Editar tarefa" onClose={onClose}>
      <Fields value={form} onChange={setForm} />

      {task.parentId === null && (
        <div className="field">
          <span>Subtarefas</span>
          <ul className="subtasks">
            {subtasks.map((s) => (
              <li key={s.id} data-done={s.completed}>
                <button
                  type="button"
                  className="task-check small"
                  data-done={s.completed}
                  aria-label={s.completed ? `Reabrir ${s.title}` : `Concluir ${s.title}`}
                  onClick={() => void (s.completed ? core.tasks.reopen(s.id) : (playSound('taskDone'), core.tasks.complete(s.id)))}
                >
                  <Icon name="check" size={14} />
                </button>
                <span>{s.title}</span>
                <button type="button" className="icon-btn" aria-label={`Excluir ${s.title}`} onClick={() => void core.tasks.remove(s.id)}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
          <div className="inline-add">
            <input
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              placeholder="Adicionar subtarefa"
              data-testid="field-sub"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addSub();
              }}
            />
            <button type="button" className="btn-soft" disabled={sub.trim() === ''} onClick={() => void addSub()}>
              <Icon name="plus" size={18} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <button
          type="button"
          className="btn-danger"
          data-testid="delete-task"
          onClick={() => {
            onDelete(task);
            onClose();
          }}
        >
          <Icon name="trash" size={18} /> Excluir
        </button>
        <button type="button" className="btn-primary" data-testid="save-edit" onClick={() => void save()}>
          Salvar
        </button>
      </div>
    </Sheet>
  );
}
