/**
 * Modelo e contratos das tarefas. Independente de SQLite e de Electron: a
 * interface de usuário e o processo principal só conhecem estes tipos.
 */

/** Limite do título, em caracteres (pontos de código, não unidades UTF-16). */
export const TASK_TITLE_MAX = 200;
/** Quanto tempo uma tarefa concluída fica guardada, contado de `completedAt`. */
export const COMPLETED_RETENTION_DAYS = 30;
/** Limite de segurança de tarefas guardadas (evita crescimento descontrolado). */
export const TASK_LIMIT = 5000;
/** Prazo para desfazer uma exclusão. Só depois dele a tarefa sai do banco. */
export const UNDO_WINDOW_MS = 5000;

export interface Task {
  /** UUID v4 gerado no cliente; estável entre dispositivos. */
  id: string;
  title: string;
  completed: boolean;
  /** ISO 8601 em UTC (`2026-10-13T12:00:00.000Z`). */
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
  /** Prazo opcional: ISO 8601 em UTC. O Mochi avisa na hora (e um pouco antes, se ligado). */
  dueAt: string | null;
}

export interface TaskLists {
  /** Em ordem de criação (a mais antiga primeiro). */
  active: Task[];
  /** A concluída mais recentemente primeiro. */
  completed: Task[];
}

/** Exclusão agendada: a tarefa já saiu das listas, mas ainda pode ser desfeita. */
export interface PendingRemoval {
  task: Task;
  /** ISO 8601 UTC: depois deste instante a exclusão passa a ser definitiva. */
  expiresAt: string;
}

/** O que as janelas veem: listas + exclusões ainda desfazíveis. */
export interface TaskSnapshot extends TaskLists {
  pendingRemovals: PendingRemoval[];
}

export type TaskErrorCode =
  | 'title_empty'
  | 'title_too_long'
  | 'invalid_title'
  | 'invalid_id'
  | 'invalid_due'
  | 'not_found'
  | 'limit_reached'
  | 'storage';

export interface TaskError {
  code: TaskErrorCode;
  message: string;
}

/** Resultado sem exceções: atravessa o IPC sem vazar pilhas de erro. */
export type TaskResult<T> = { ok: true; value: T } | { ok: false; error: TaskError };

export const ok = <T>(value: T): TaskResult<T> => ({ ok: true, value });
export const fail = <T = never>(code: TaskErrorCode, message: string): TaskResult<T> => ({
  ok: false,
  error: { code, message },
});

/**
 * Repositório de tarefas. Assíncrono de propósito: a implementação local
 * (SQLite) responde na hora, mas uma futura implementação remota/sincronizada
 * pode substituí-la ou complementá-la sem mudar quem a usa.
 */
export interface TaskRepository {
  list(): Promise<TaskLists>;
  /** Busca uma tarefa (aplicando a retenção: uma concluída expirada não existe mais). */
  get(id: string): Promise<TaskResult<Task>>;
  create(title: string, dueAt?: string | null): Promise<TaskResult<Task>>;
  /** Define (ou remove, com `null`) o prazo. */
  setDue(id: string, dueAt: string | null): Promise<TaskResult<Task>>;
  complete(id: string): Promise<TaskResult<Task>>;
  reopen(id: string): Promise<TaskResult<Task>>;
  remove(id: string): Promise<TaskResult<null>>;
}

/** Mudanças confirmadas no armazenamento (usadas para avisar as janelas). */
export type TaskChange =
  | { type: 'created'; id: string }
  | { type: 'completed'; id: string }
  | { type: 'reopened'; id: string }
  | { type: 'updated'; id: string }
  | { type: 'removed'; id: string }
  | { type: 'purged'; count: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTaskId = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/** Quantos caracteres o título (sem espaços nas pontas) tem, contando pontos de código. */
export function titleLength(input: string): number {
  return [...input.trim()].length;
}

/** Valida e normaliza um título (remove espaços nas pontas). */
export function validateTitle(input: unknown): TaskResult<string> {
  if (typeof input !== 'string') return fail('invalid_title', 'O título precisa ser um texto.');
  const title = input.trim();
  if (title.length === 0) return fail('title_empty', 'Escreva um título para a tarefa.');
  // Pontos de código: um emoji conta como 1 caractere.
  if (titleLength(title) > TASK_TITLE_MAX) {
    return fail('title_too_long', `O título pode ter até ${TASK_TITLE_MAX} caracteres.`);
  }
  return ok(title);
}

/** Anos aceitos num prazo (barra datas absurdas vindas de um campo mal preenchido). */
const DUE_MIN_YEAR = 2000;
const DUE_MAX_YEAR = 2100;

/**
 * Valida o prazo: `null`/ausente = sem prazo; senão um instante ISO 8601 (UTC, com milissegundos ou
 * não). Devolve sempre a forma canônica (`toISOString`), então comparações de texto ordenam por data.
 */
export function validateDue(input: unknown): TaskResult<string | null> {
  if (input === null || input === undefined) return ok(null);
  if (typeof input !== 'string' || input.length > 40) return fail('invalid_due', 'Data e hora inválidas.');
  const ms = Date.parse(input);
  if (!Number.isFinite(ms)) return fail('invalid_due', 'Data e hora inválidas.');
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  if (year < DUE_MIN_YEAR || year > DUE_MAX_YEAR) return fail('invalid_due', 'Escolha uma data entre 2000 e 2100.');
  return ok(date.toISOString());
}

/** Situação do prazo em relação a `now`, para destacar a tarefa na lista. */
export type DueStatus = 'none' | 'overdue' | 'today' | 'later';

export function dueStatus(task: Pick<Task, 'dueAt' | 'completed'>, now: Date): DueStatus {
  if (!task.dueAt || task.completed) return 'none';
  const due = new Date(task.dueAt);
  if (due.getTime() < now.getTime()) return 'overdue';
  const sameDay =
    due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
  return sameDay ? 'today' : 'later';
}

/** Lembrete de prazo entregue às janelas (`soon` = faltam `minutes` min; `due` = chegou a hora). */
export interface TaskReminder {
  taskId: string;
  title: string;
  kind: 'soon' | 'due';
  dueAt: string;
  minutes: number;
}

/** API de tarefas exposta ao renderer (`window.mochi.tasks`). */
export interface TasksApi {
  list(): Promise<TaskResult<TaskSnapshot>>;
  create(title: string, dueAt?: string | null): Promise<TaskResult<Task>>;
  /** Define (ou remove, com `null`) o prazo de uma tarefa. */
  setDue(id: string, dueAt: string | null): Promise<TaskResult<Task>>;
  complete(id: string): Promise<TaskResult<Task>>;
  reopen(id: string): Promise<TaskResult<Task>>;
  /**
   * Agenda a exclusão: a tarefa some das listas e só é apagada do banco depois
   * de UNDO_WINDOW_MS, a menos que undoRemove seja chamado antes.
   */
  scheduleRemove(id: string): Promise<TaskResult<PendingRemoval>>;
  /** Cancela uma exclusão agendada (falha se o prazo acabou ou a tarefa expirou). */
  undoRemove(id: string): Promise<TaskResult<Task>>;
  /** Aviso sobre o armazenamento (arquivo recuperado, versão mais nova, falha ao abrir) ou null. */
  notice(): Promise<string | null>;
  dismissNotice(): Promise<void>;
  /** Alguma tarefa mudou (em qualquer janela): recarregue a lista. */
  onChange(listener: () => void): () => void;
  /** Uma tarefa foi concluída agora (não dispara ao reabrir ou excluir). */
  onCompleted(listener: () => void): () => void;
  /** Uma tarefa foi criada agora. */
  onCreated(listener: () => void): () => void;
  /** Chegou um lembrete de prazo. */
  onReminder(listener: (reminder: TaskReminder) => void): () => void;
}
