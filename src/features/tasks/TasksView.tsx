import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  COMPLETED_RETENTION_DAYS,
  TASK_TITLE_MAX,
  UNDO_WINDOW_MS,
  titleLength,
  validateTitle,
  type PendingRemoval,
  type Task,
  type TaskResult,
} from '../../../shared/tasks';
import { dueStatus, validateDue } from '../../../shared/tasks';
import { formatDue, fromLocalInputValue, presetDue, toLocalInputValue } from './dueFormat';
import { draftStore, useDraft } from './draftStore';
import { useTasks } from './useTasks';
import { StorageNotice } from './StorageNotice';
import { AgendaSection } from '../calendar/AgendaSection';
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

/** Lista de tarefas: usada no painel (modo flutuante) e na ilha expandida. */
export function TasksView({ variant, onBack }: TasksViewProps) {
  const tasks = useTasks();
  const draft = useDraft();
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
    setAnnouncement(announceTick.current % 2 === 0 ? `${text} ` : text);
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

  // Foco depois de excluir (vai ao "Desfazer") e depois de desfazer (volta à tarefa).
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
        {tasks.active.length > 0 && <span className="tasks-count">{tasks.active.length}</span>}
      </header>

      <StorageNotice />
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
          {tasks.active.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              busy={busy.has(task.id)}
              primary={{
                label: 'Concluir tarefa',
                kind: 'check',
                onClick: () => void run(task, 'concluir', () => tasks.complete(task.id), `Tarefa concluída: ${task.title}`),
              }}
              onRemove={(row) => void remove(task, row)}
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
          aria-expanded={showCompleted && tasks.completed.length > 0}
          aria-controls={completedId}
          disabled={tasks.completed.length === 0}
          onClick={() => setShowCompleted((v) => !v)}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
            data-open={showCompleted && tasks.completed.length > 0}
          >
            <path d="M9 6l6 6-6 6" {...icon} />
          </svg>
          Concluídas ({tasks.completed.length})
        </button>
        {showCompleted && tasks.completed.length > 0 && (
          <div id={completedId} className="tasks-completed-body">
            <ul className="tasks-list" aria-label="Tarefas concluídas">
              {tasks.completed.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  done
                  busy={busy.has(task.id)}
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
  primary: { label: string; kind: 'check' | 'undo'; onClick: () => void };
  onRemove: (row: HTMLElement | null) => void;
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

function TaskRow({ task, done = false, busy, primary, onRemove, due }: TaskRowProps) {
  const ref = useRef<HTMLLIElement | null>(null);
  const status = dueStatus(task, new Date());
  const dueText = task.dueAt && !done ? formatDue(task.dueAt) : '';
  return (
    <li className="task" ref={ref} data-task-id={task.id} data-done={done} data-busy={busy} data-due={status}>
      <button
        type="button"
        className="task-primary"
        data-kind={primary.kind}
        onClick={primary.onClick}
        disabled={busy}
        aria-label={`${primary.label}: ${task.title}`}
        title={primary.label}
      >
        {primary.kind === 'check' ? (
          <span className="task-circle" aria-hidden="true" />
        ) : (
          <Icon>
            <path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 12" {...icon} transform="translate(0 -4)" />
          </Icon>
        )}
      </button>
      <span className="task-title">{task.title}</span>
      {done && <span className="task-date">{formatDay(task.completedAt)}</span>}
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
      <button
        type="button"
        className="tasks-icon-button task-remove"
        onClick={() => onRemove(ref.current)}
        disabled={busy}
        aria-label={`Excluir tarefa: ${task.title}`}
        title="Excluir (dá para desfazer)"
      >
        <Icon>
          <path d="M6 6l12 12M18 6L6 18" {...icon} />
        </Icon>
      </button>
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
        </div>
      )}
    </li>
  );
}
