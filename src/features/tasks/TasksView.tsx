import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  COMPLETED_RETENTION_DAYS,
  PRIORITY_LABEL,
  RECURRENCE_LABEL,
  TASK_RECURRENCES,
  TASK_TITLE_MAX,
  UNDO_WINDOW_MS,
  titleLength,
  validateTitle,
  type PendingRemoval,
  type Task,
  type TaskPriority,
  type TaskRecurrence,
  type TaskResult,
} from '../../../shared/tasks';
import { dueStatus, validateDue } from '../../../shared/tasks';
import { formatDue, fromLocalInputValue, presetDue, toLocalInputValue } from './dueFormat';
import { draftStore, useDraft } from './draftStore';
import { useTasks } from './useTasks';
import { StorageNotice } from './StorageNotice';
import { AgendaSection } from '../calendar/AgendaSection';
import { openLinkedNote, useNoteLinks } from '../notes/useNoteLinks';
import { DaySummaryCard } from '../routine/DaySummaryCard';
import './tasks.css';

interface TasksViewProps {
  /** `island`: tema escuro, compacto. `panel`: janela do painel. */
  variant: 'island' | 'panel';
  /** Quando presente, mostra o botão de voltar (usado na ilha). */
  onBack?: () => void;
}

const icon = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const formatDay = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : '');

const NEXT_PRIORITY: Record<TaskPriority, TaskPriority> = { 0: 1, 1: 2, 2: 3, 3: 0 };

/** Amanhã às 9h (horário local), em ISO. */
function tomorrowMorning(now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0).toISOString();
}

/** Lista de tarefas: usada no painel (modo flutuante) e na ilha expandida. */
export function TasksView({ variant, onBack }: TasksViewProps) {
  const tasks = useTasks();
  const draft = useDraft();
  const noteLinks = useNoteLinks();
  const [formError, setFormError] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [showCompleted, setShowCompleted] = useState(false); // recolhida por padrão
  /** Prazo da NOVA tarefa (valor do campo, horário local) e se a linha do prazo está aberta. */
  const [dueText, setDueText] = useState('');
  const [showDue, setShowDue] = useState(false);
  /** Tarefa cujo prazo está sendo editado e o valor do campo. */
  const [editingDue, setEditingDue] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  /** Arrastar para reordenar: tarefa em movimento e a que está sob o ponteiro. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** Espelho síncrono de dragId (o soltar pode chegar antes de o React re-renderizar). */
  const dragRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const focusUndoNext = useRef(false);
  const focusTaskId = useRef<string | null>(null);
  const announceTick = useRef(0);
  const completedId = useId();
  const errorId = useId();
  const counterId = useId();

  /** Anuncia para leitores de tela (a alternância evita que texto repetido seja ignorado). */
  const announce = useCallback((text: string) => {
    announceTick.current += 1;
    setAnnouncement(announceTick.current % 2 === 0 ? `${text} ` : text);
  }, []);

  // Foco automático ao abrir a tela; no painel, também sempre que a janela volta ao foco.
  useEffect(() => {
    inputRef.current?.focus();
    if (variant !== 'panel') return;
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [variant]);

  // Ao sair da tela o campo deixa de ter foco: a ilha volta a poder recolher sozinha.
  useEffect(() => () => draftStore.setFocused(false), []);

  const length = titleLength(draft.text);
  const over = length > TASK_TITLE_MAX;
  const overBy = length - TASK_TITLE_MAX;
  const limitMessage = over
    ? `O título tem ${overBy} ${overBy === 1 ? 'caractere' : 'caracteres'} a mais. O limite é ${TASK_TITLE_MAX}.`
    : null;
  const shownFormError = limitMessage ?? formError;

  /** Principais ativas (na ordem) e, por tarefa-mãe, as subtarefas (ativas e concluídas). */
  const { tops, subsByParent, hiddenCompleted } = useMemo(() => {
    const activeIds = new Set(tasks.active.map((t) => t.id));
    const everything = [...tasks.active, ...tasks.completed];
    const byParent = new Map<string, Task[]>();
    for (const t of everything) {
      if (t.parentId && activeIds.has(t.parentId)) {
        const list = byParent.get(t.parentId) ?? [];
        list.push(t);
        byParent.set(t.parentId, list);
      }
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => Number(a.completed) - Number(b.completed) || a.createdAt.localeCompare(b.createdAt));
    }
    return {
      // subtarefa cuja principal sumiu (retenção) volta a aparecer como tarefa comum
      tops: tasks.active.filter((t) => !t.parentId || !activeIds.has(t.parentId)),
      subsByParent: byParent,
      // concluídas que já aparecem sob uma principal ativa não entram na lista de "Concluídas"
      hiddenCompleted: new Set(tasks.completed.filter((t) => t.parentId && activeIds.has(t.parentId)).map((t) => t.id)),
    };
  }, [tasks.active, tasks.completed]);
  const completedShown = tasks.completed.filter((t) => !hiddenCompleted.has(t.id));

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    // A mesma validação do backend (que continua sendo a autoridade).
    const valid = validateTitle(draft.text);
    if (!valid.ok) {
      setFormError(valid.error.message);
      inputRef.current?.focus();
      return;
    }
    // Prazo: campo vazio = sem prazo; preenchido e inválido bloqueia (nunca descarta em silêncio).
    let dueAt: string | null = null;
    if (dueText.trim() !== '') {
      dueAt = fromLocalInputValue(dueText);
      const checked = validateDue(dueAt);
      if (dueAt === null || !checked.ok) {
        setFormError('Data e hora do prazo inválidas.');
        return;
      }
    }
    const result = await tasks.create(draft.text, dueAt);
    if (!result.ok) {
      setFormError(result.error.message);
      inputRef.current?.focus();
      return;
    }
    draftStore.clear();
    setDueText('');
    setShowDue(false);
    setFormError(null);
    setOpError(null);
    announce(`Tarefa adicionada: ${result.value.title}`);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault(); // título de uma linha: Enter envia (nunca insere quebra)
      void submit();
    }
  };

  /** Executa uma operação de uma tarefa e mostra qualquer falha, sem fingir sucesso. */
  const run = async (
    task: Task,
    failVerb: string,
    op: () => Promise<TaskResult<unknown>>,
    successText: string,
  ) => {
    if (busy.has(task.id)) return;
    setBusy((s) => new Set(s).add(task.id));
    let result: TaskResult<unknown>;
    try {
      result = await op();
    } catch {
      result = { ok: false, error: { code: 'storage', message: 'Falha de comunicação com o aplicativo.' } };
    }
    setBusy((s) => {
      const next = new Set(s);
      next.delete(task.id);
      return next;
    });
    if (result.ok) {
      setOpError(null);
      announce(successText);
    } else {
      setOpError(`Não foi possível ${failVerb} “${task.title}”. ${result.error.message}`);
      void tasks.reload(); // a lista pode estar desatualizada (ex.: tarefa já removida)
    }
    return result.ok;
  };

  const remove = async (task: Task, row: HTMLElement | null) => {
    if (row?.contains(document.activeElement)) focusUndoNext.current = true;
    const ok = await run(
      task,
      'excluir',
      () => tasks.scheduleRemove(task.id),
      `Tarefa excluída: ${task.title}. Desfazer disponível por ${UNDO_WINDOW_MS / 1000} segundos.`,
    );
    if (ok) await tasks.reload();
    else focusUndoNext.current = false;
  };

  const undo = async (removal: PendingRemoval) => {
    const ok = await run(removal.task, 'desfazer a exclusão de', () => tasks.undoRemove(removal.task.id), `Exclusão desfeita: ${removal.task.title}`);
    if (ok) focusTaskId.current = removal.task.id;
    await tasks.reload();
  };

  /** Move a tarefa `id` para a posição de `targetId` (ou uma casa acima/abaixo) e grava a ordem. */
  const reorder = async (id: string, targetIndex: number) => {
    const ids = tops.map((t) => t.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    const to = Math.max(0, Math.min(ids.length - 1, targetIndex));
    if (to === from) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const result = await tasks.reorder(ids);
    if (result.ok) {
      announce(`Tarefa movida para a posição ${to + 1} de ${ids.length}.`);
      focusTaskId.current = id;
    } else {
      setOpError(result.error.message);
    }
    await tasks.reload();
  };

  // Foco depois de excluir (vai ao "Desfazer") e depois de desfazer/mover (volta à tarefa).
  useEffect(() => {
    if (focusUndoNext.current && tasks.pendingRemovals.length > 0) {
      focusUndoNext.current = false;
      undoRef.current?.focus();
    }
    if (focusTaskId.current) {
      const el = document.querySelector<HTMLElement>(`[data-task-id="${focusTaskId.current}"] .task-primary`);
      if (el) {
        focusTaskId.current = null;
        el.focus();
      }
    }
  }, [tasks.pendingRemovals, tasks.active, tasks.completed]);

  const isEmpty = tasks.status === 'ready' && tasks.active.length === 0;
  const lastPending = tasks.pendingRemovals.length - 1;

  return (
    // `data-island-control`: cliques aqui não expandem/recolhem a ilha.
    <section className="tasks" data-variant={variant} data-island-control aria-label="Tarefas">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <header className="tasks-header">
        {onBack && (
          <button type="button" className="tasks-icon-button" onClick={onBack} aria-label="Voltar aos atalhos">
            <Icon>
              <path d="M15 5l-7 7 7 7" {...icon} />
            </Icon>
          </button>
        )}
        <h2>Tarefas</h2>
        {tops.length > 0 && <span className="tasks-count">{tops.length}</span>}
      </header>

      <StorageNotice />
      <DaySummaryCard />
      <AgendaSection variant={variant} />

      <form className="tasks-form" onSubmit={submit} noValidate>
        <textarea
          ref={inputRef}
          className="tasks-input"
          rows={1}
          value={draft.text}
          placeholder="Nova tarefa"
          aria-label="Nova tarefa"
          aria-invalid={shownFormError ? true : undefined}
          aria-describedby={[shownFormError ? errorId : null, counterId].filter(Boolean).join(' ')}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onFocus={() => draftStore.setFocused(true)}
          onBlur={() => draftStore.setFocused(false)}
          onChange={(e) => {
            // Colar texto com quebras de linha: vira espaço (o título tem uma linha).
            draftStore.setText(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '));
            if (formError) setFormError(null);
          }}
        />
        <button
          type="button"
          className="tasks-icon-button tasks-due-toggle"
          aria-expanded={showDue}
          aria-label={dueText ? `Prazo: ${formatDue(fromLocalInputValue(dueText) ?? '')}` : 'Definir prazo da nova tarefa'}
          title="Prazo"
          data-set={dueText !== ''}
          onClick={() => setShowDue((v) => !v)}
        >
          <Icon>
            <circle cx="12" cy="13" r="7" {...icon} />
            <path d="M12 9.5V13l2.4 1.6M9.5 3.5h5" {...icon} />
          </Icon>
        </button>
        <button type="submit" className="tasks-add" disabled={over} title={over ? 'Reduza o título para adicionar' : undefined}>
          Adicionar
        </button>
      </form>
      {showDue && (
        <div className="tasks-due-row">
          <input
            type="datetime-local"
            className="tasks-due-input"
            aria-label="Prazo da nova tarefa"
            value={dueText}
            onChange={(e) => setDueText(e.target.value)}
          />
          <button type="button" className="tasks-due-chip" onClick={() => setDueText(presetDue('today'))}>
            Hoje
          </button>
          <button type="button" className="tasks-due-chip" onClick={() => setDueText(presetDue('tomorrow'))}>
            Amanhã
          </button>
          {dueText !== '' && (
            <button type="button" className="tasks-due-chip" onClick={() => setDueText('')}>
              Limpar
            </button>
          )}
        </div>
      )}
      <div className="tasks-meta">
        {length > 0 && (
          <span id={counterId} className="tasks-counter" data-over={over} aria-label={`${length} de ${TASK_TITLE_MAX} caracteres`}>
            {length}/{TASK_TITLE_MAX}
          </span>
        )}
      </div>
      {shownFormError && (
        <p id={errorId} className="tasks-error" role="alert">
          {shownFormError}
        </p>
      )}
      {opError && (
        <p className="tasks-error" role="alert">
          {opError}
        </p>
      )}
      {tasks.status === 'error' && (
        <p className="tasks-error" role="alert">
          {tasks.error}
        </p>
      )}

      <div className="tasks-scroll">
        {isEmpty && <p className="tasks-empty">Nenhuma tarefa por enquanto. Que tal começar?</p>}

        <ul className="tasks-list" aria-label="Tarefas ativas">
          {tops.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              busy={busy.has(task.id)}
              subs={subsByParent.get(task.id) ?? []}
              busyIds={busy}
              noteId={noteLinks.byTask.get(task.id) ?? null}
              onNote={async () => {
                const problem = await openLinkedNote({ taskId: task.id }, task.title, task.dueAt ? formatDue(task.dueAt) : undefined);
                if (problem) setOpError(`Não foi possível abrir as anotações. ${problem}`);
              }}
              position={{ index, total: tops.length }}
              drag={{
                dragging: dragId === task.id,
                over: overId === task.id && dragId !== null && dragId !== task.id,
                onStart: () => {
                  dragRef.current = task.id;
                  setDragId(task.id);
                },
                onOver: () => setOverId(task.id),
                onDrop: () => {
                  const from = dragRef.current;
                  dragRef.current = null;
                  setDragId(null);
                  setOverId(null);
                  if (from && from !== task.id) void reorder(from, index);
                },
                onEnd: () => {
                  dragRef.current = null;
                  setDragId(null);
                  setOverId(null);
                },
                onMove: (delta) => void reorder(task.id, index + delta),
              }}
              primary={{
                label: 'Concluir tarefa',
                kind: 'check',
                onClick: () => void run(task, 'concluir', () => tasks.complete(task.id), `Tarefa concluída: ${task.title}`),
              }}
              onRemove={(row) => void remove(task, row)}
              onRename={(title) => run(task, 'renomear', () => tasks.update(task.id, { title }), `Tarefa renomeada: ${title}`)}
              onPriority={() =>
                void run(
                  task,
                  'alterar a prioridade de',
                  () => tasks.update(task.id, { priority: NEXT_PRIORITY[task.priority] }),
                  `Prioridade: ${PRIORITY_LABEL[NEXT_PRIORITY[task.priority]]}`,
                )
              }
              onRecurrence={(value) =>
                void run(
                  task,
                  'alterar a repetição de',
                  () => tasks.update(task.id, { recurrence: value }),
                  value ? `Repete: ${RECURRENCE_LABEL[value]}` : 'Sem repetição',
                )
              }
              onSnooze={(iso, label) =>
                void run(task, 'adiar', () => tasks.setDue(task.id, iso), `Tarefa adiada: ${label}`)
              }
              onAddSub={async (title) => {
                const ok = await run(
                  task,
                  'adicionar subtarefa em',
                  () => tasks.create(title, null, null, { parentId: task.id }),
                  `Subtarefa adicionada: ${title}`,
                );
                if (ok) window.mochi.bond.event('subtask');
                return ok;
              }}
              onToggleSub={(sub) =>
                void run(
                  sub,
                  sub.completed ? 'reabrir' : 'concluir',
                  () => (sub.completed ? tasks.reopen(sub.id) : tasks.complete(sub.id)),
                  sub.completed ? `Subtarefa reaberta: ${sub.title}` : `Subtarefa concluída: ${sub.title}`,
                )
              }
              onRemoveSub={(sub) => void remove(sub, null)}
              due={{
                editing: editingDue === task.id,
                value: editingDue === task.id ? editValue : '',
                onToggle: () => {
                  if (editingDue === task.id) {
                    setEditingDue(null);
                  } else {
                    setEditingDue(task.id);
                    setEditValue(toLocalInputValue(task.dueAt));
                  }
                },
                onChange: setEditValue,
                onSave: () => {
                  const iso = editValue.trim() === '' ? null : fromLocalInputValue(editValue);
                  if (editValue.trim() !== '' && iso === null) {
                    setOpError('Data e hora do prazo inválidas.');
                    return;
                  }
                  setEditingDue(null);
                  void run(task, 'alterar o prazo de', () => tasks.setDue(task.id, iso), `Prazo atualizado: ${task.title}`);
                },
                onClear: () => {
                  setEditingDue(null);
                  void run(task, 'remover o prazo de', () => tasks.setDue(task.id, null), `Prazo removido: ${task.title}`);
                },
              }}
            />
          ))}
        </ul>
      </div>

      {tasks.pendingRemovals.length > 0 && (
        <div className="tasks-undo-area">
          {tasks.pendingRemovals.map((removal, i) => (
            <div className="tasks-undo" key={removal.task.id}>
              <span className="tasks-undo-text">“{removal.task.title}” excluída</span>
              <button
                type="button"
                ref={i === lastPending ? undoRef : undefined}
                className="tasks-undo-button"
                onClick={() => void undo(removal)}
                aria-label={`Desfazer a exclusão de ${removal.task.title}`}
              >
                Desfazer
              </button>
              <span
                className="tasks-undo-timer"
                aria-hidden="true"
                style={{ animationDuration: `${Math.max(0, new Date(removal.expiresAt).getTime() - Date.now())}ms` }}
              />
            </div>
          ))}
        </div>
      )}

      <footer className="tasks-footer">
        <button
          type="button"
          className="tasks-disclosure"
          aria-expanded={showCompleted && completedShown.length > 0}
          aria-controls={completedId}
          disabled={completedShown.length === 0}
          onClick={() => setShowCompleted((v) => !v)}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
            data-open={showCompleted && completedShown.length > 0}
          >
            <path d="M9 6l6 6-6 6" {...icon} />
          </svg>
          Concluídas ({completedShown.length})
        </button>
        {showCompleted && completedShown.length > 0 && (
          <div id={completedId} className="tasks-completed-body">
            <ul className="tasks-list" aria-label="Tarefas concluídas">
              {completedShown.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  done
                  busy={busy.has(task.id)}
                  subs={[]}
                  busyIds={busy}
                  primary={{
                    label: 'Reabrir tarefa',
                    kind: 'undo',
                    onClick: () => void run(task, 'reabrir', () => tasks.reopen(task.id), `Tarefa reaberta: ${task.title}`),
                  }}
                  onRemove={(row) => void remove(task, row)}
                />
              ))}
            </ul>
            <p className="tasks-hint">Removidas automaticamente {COMPLETED_RETENTION_DAYS} dias após a conclusão.</p>
          </div>
        )}
      </footer>
    </section>
  );
}

interface TaskRowProps {
  task: Task;
  done?: boolean;
  busy: boolean;
  /** Subtarefas (ativas e concluídas) desta tarefa. */
  subs: Task[];
  busyIds: ReadonlySet<string>;
  /** Nota ligada a esta tarefa (anotações), se já existe. */
  noteId?: string | null;
  onNote?: () => void;
  /** Posição entre as principais ativas (habilita mover com Alt+setas). */
  position?: { index: number; total: number };
  drag?: {
    dragging: boolean;
    over: boolean;
    onStart: () => void;
    onOver: () => void;
    onDrop: () => void;
    onEnd: () => void;
    onMove: (delta: number) => void;
  };
  primary: { label: string; kind: 'check' | 'undo'; onClick: () => void };
  onRemove: (row: HTMLElement | null) => void;
  onRename?: (title: string) => Promise<boolean | undefined>;
  onPriority?: () => void;
  onRecurrence?: (value: TaskRecurrence | null) => void;
  onSnooze?: (iso: string, label: string) => void;
  onAddSub?: (title: string) => Promise<boolean | undefined>;
  onToggleSub?: (sub: Task) => void;
  onRemoveSub?: (sub: Task) => void;
  /** Só tarefas ativas têm prazo editável. */
  due?: {
    editing: boolean;
    value: string;
    onToggle: () => void;
    onChange: (value: string) => void;
    onSave: () => void;
    onClear: () => void;
  };
}

function TaskRow({
  task,
  done = false,
  busy,
  subs,
  busyIds,
  noteId,
  onNote,
  position,
  drag,
  primary,
  onRemove,
  onRename,
  onPriority,
  onRecurrence,
  onSnooze,
  onAddSub,
  onToggleSub,
  onRemoveSub,
  due,
}: TaskRowProps) {
  const ref = useRef<HTMLLIElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [addingSub, setAddingSub] = useState(false);
  const [subText, setSubText] = useState('');
  const status = dueStatus(task, new Date());
  const dueText = task.dueAt && !done ? formatDue(task.dueAt) : '';
  const doneSubs = subs.filter((s) => s.completed).length;

  const startRename = () => {
    if (!onRename || done) return;
    setName(task.title);
    setRenaming(true);
  };
  const commitRename = async () => {
    const next = name.trim();
    setRenaming(false);
    if (next !== '' && next !== task.title && onRename) await onRename(next);
  };
  const commitSub = async () => {
    const text = subText.trim();
    if (text === '' || !onAddSub) return;
    const ok = await onAddSub(text);
    if (ok) setSubText('');
  };

  return (
    <li
      className="task"
      ref={ref}
      data-task-id={task.id}
      data-done={done}
      data-busy={busy}
      data-due={status}
      data-priority={task.priority}
      data-dragging={drag?.dragging ?? false}
      data-over={drag?.over ?? false}
      draggable={!!drag && !renaming}
      onDragStart={(e) => {
        if (!drag) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        drag.onStart();
      }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.onOver();
      }}
      onDrop={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.onDrop();
      }}
      onDragEnd={() => drag?.onEnd()}
    >
      <button
        type="button"
        className="task-primary"
        data-kind={primary.kind}
        onClick={primary.onClick}
        onKeyDown={(e) => {
          // Alt+↑/↓: mover a tarefa (alternativa de teclado ao arrastar)
          if (drag && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            drag.onMove(e.key === 'ArrowUp' ? -1 : 1);
          }
        }}
        disabled={busy}
        aria-label={`${primary.label}: ${task.title}`}
        aria-keyshortcuts={drag ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
        title={drag ? `${primary.label} (Alt+↑/↓ move a tarefa)` : primary.label}
      >
        {primary.kind === 'check' ? (
          <span className="task-circle" aria-hidden="true" />
        ) : (
          <Icon>
            <path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 12" {...icon} transform="translate(0 -4)" />
          </Icon>
        )}
      </button>
      {renaming ? (
        <input
          className="task-rename"
          value={name}
          maxLength={TASK_TITLE_MAX + 20}
          aria-label={`Novo título de ${task.title}`}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commitRename();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setRenaming(false);
            }
          }}
        />
      ) : (
        <span
          className="task-title"
          onDoubleClick={startRename}
          title={onRename && !done ? 'Duplo clique para editar' : undefined}
        >
          {task.recurrence && !done && (
            <span className="task-repeat" role="img" aria-label={`Repete: ${RECURRENCE_LABEL[task.recurrence]}`} title={RECURRENCE_LABEL[task.recurrence]}>
              ↻{' '}
            </span>
          )}
          {task.title}
        </span>
      )}
      <div className="task-actions">
      {subs.length > 0 && !done && (
        <span className="task-subcount" aria-label={`${doneSubs} de ${subs.length} subtarefas concluídas`}>
          {doneSubs}/{subs.length}
        </span>
      )}
      {done && <span className="task-date">{formatDay(task.completedAt)}</span>}
      {onPriority && !done && (
        <button
          type="button"
          className="task-priority"
          data-priority={task.priority}
          onClick={onPriority}
          disabled={busy}
          aria-label={`Prioridade: ${PRIORITY_LABEL[task.priority]}. Alterar`}
          title={`Prioridade: ${PRIORITY_LABEL[task.priority]}`}
        >
          <span aria-hidden="true" />
        </button>
      )}
      {due && !done && (
        <button
          type="button"
          className="task-due"
          data-status={status}
          data-empty={dueText === ''}
          aria-expanded={due.editing}
          aria-label={dueText ? `Prazo: ${dueText}${status === 'overdue' ? ' (atrasada)' : ''}. Alterar` : `Definir prazo: ${task.title}`}
          title={dueText ? 'Alterar prazo' : 'Definir prazo'}
          onClick={due.onToggle}
          disabled={busy}
        >
          {dueText ? (
            <>
              {status === 'overdue' && <span className="sr-only">Atrasada. </span>}
              {dueText}
            </>
          ) : (
            <Icon>
              <circle cx="12" cy="13" r="7" {...icon} />
              <path d="M12 9.5V13l2.4 1.6M9.5 3.5h5" {...icon} />
            </Icon>
          )}
        </button>
      )}
      {onNote && !done && (
        <button
          type="button"
          className="tasks-icon-button task-note"
          data-has={!!noteId}
          aria-label={noteId ? `Abrir anotações da tarefa: ${task.title}` : `Criar anotações da tarefa: ${task.title}`}
          title={noteId ? 'Abrir anotações' : 'Anotações da tarefa (cria uma nota)'}
          onClick={onNote}
          disabled={busy}
        >
          <Icon>
            <path d="M6 4h8.5L18 7.500V20H6zM9 11h6M9 15h4" {...icon} />
          </Icon>
        </button>
      )}
      {onAddSub && !done && (
        <button
          type="button"
          className="tasks-icon-button task-addsub"
          aria-expanded={addingSub}
          aria-label={`Adicionar subtarefa em: ${task.title}`}
          title="Adicionar subtarefa"
          onClick={() => setAddingSub((v) => !v)}
          disabled={busy}
        >
          <Icon>
            <path d="M12 5v14M5 12h14" {...icon} />
          </Icon>
        </button>
      )}
      <button
        type="button"
        className="tasks-icon-button task-remove"
        onClick={() => onRemove(ref.current)}
        disabled={busy}
        aria-label={`Excluir tarefa: ${task.title}`}
        title={subs.length > 0 ? 'Excluir com as subtarefas (dá para desfazer)' : 'Excluir (dá para desfazer)'}
      >
        <Icon>
          <path d="M6 6l12 12M18 6L6 18" {...icon} />
        </Icon>
      </button>
      </div>

      {due?.editing && (
        <div className="task-due-editor">
          <input
            type="datetime-local"
            className="tasks-due-input"
            aria-label={`Prazo de ${task.title}`}
            value={due.value}
            onChange={(e) => due.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') due.onSave();
            }}
          />
          <button type="button" className="tasks-due-chip" onClick={due.onSave}>
            Salvar
          </button>
          {task.dueAt && (
            <button type="button" className="tasks-due-chip" onClick={due.onClear}>
              Sem prazo
            </button>
          )}
          {onSnooze && (
            <div className="task-snooze" role="group" aria-label="Adiar">
              <span>Adiar:</span>
              <button type="button" className="tasks-due-chip" onClick={() => onSnooze(new Date(Date.now() + 10 * 60_000).toISOString(), '+10 min')}>
                +10 min
              </button>
              <button type="button" className="tasks-due-chip" onClick={() => onSnooze(new Date(Date.now() + 60 * 60_000).toISOString(), '+1 h')}>
                +1 h
              </button>
              <button type="button" className="tasks-due-chip" onClick={() => onSnooze(tomorrowMorning(), 'amanhã às 9h')}>
                Amanhã 9h
              </button>
            </div>
          )}
          {onRecurrence && (
            <label className="task-repeat-field">
              <span>Repetir:</span>
              <select
                value={task.recurrence ?? ''}
                disabled={!task.dueAt}
                onChange={(e) => onRecurrence((e.target.value || null) as TaskRecurrence | null)}
                aria-label={`Repetição de ${task.title}`}
              >
                <option value="">Não repete</option>
                {TASK_RECURRENCES.map((r) => (
                  <option key={r} value={r}>
                    {RECURRENCE_LABEL[r]}
                  </option>
                ))}
              </select>
              {!task.dueAt && <small>Defina um prazo para repetir.</small>}
            </label>
          )}
        </div>
      )}

      {!done && (subs.length > 0 || addingSub) && (
        <div className="task-subs">
          {subs.length > 0 && (
            <ul aria-label={`Subtarefas de ${task.title}`}>
              {subs.map((sub) => (
                <li key={sub.id} className="task-sub" data-done={sub.completed} data-busy={busyIds.has(sub.id)}>
                  <button
                    type="button"
                    className="task-primary task-sub-check"
                    onClick={() => onToggleSub?.(sub)}
                    disabled={busyIds.has(sub.id)}
                    aria-label={`${sub.completed ? 'Reabrir' : 'Concluir'} subtarefa: ${sub.title}`}
                    title={sub.completed ? 'Reabrir' : 'Concluir'}
                  >
                    <span className="task-circle" data-checked={sub.completed} aria-hidden="true" />
                  </button>
                  <span className="task-sub-title">{sub.title}</span>
                  <button
                    type="button"
                    className="tasks-icon-button task-remove"
                    onClick={() => onRemoveSub?.(sub)}
                    disabled={busyIds.has(sub.id)}
                    aria-label={`Excluir subtarefa: ${sub.title}`}
                    title="Excluir subtarefa (dá para desfazer)"
                  >
                    <Icon>
                      <path d="M6 6l12 12M18 6L6 18" {...icon} />
                    </Icon>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {addingSub && (
            <form
              className="task-subform"
              onSubmit={(e) => {
                e.preventDefault();
                void commitSub();
              }}
            >
              <input
                className="task-sub-input"
                value={subText}
                maxLength={TASK_TITLE_MAX + 20}
                placeholder="Nova subtarefa"
                aria-label={`Nova subtarefa de ${task.title}`}
                autoFocus
                onChange={(e) => setSubText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAddingSub(false);
                    setSubText('');
                  }
                }}
              />
              <button type="submit" className="tasks-due-chip" disabled={subText.trim() === ''}>
                Adicionar
              </button>
            </form>
          )}
        </div>
      )}
      {position && position.total > 1 && (
        <span className="sr-only">
          Posição {position.index + 1} de {position.total}.
        </span>
      )}
    </li>
  );
}
