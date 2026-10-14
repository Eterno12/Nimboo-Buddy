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
  /**
   * De onde a tarefa veio (hoje: o id estável de um evento da agenda, `<uid>|<início em ms>`) ou `null`.
   * Serve para o botão "Virar tarefa" não duplicar e para os lembretes não avisarem duas vezes.
   */
  sourceRef: string | null;
  /** 0 = sem prioridade, 1 = baixa, 2 = média, 3 = alta. */
  priority: TaskPriority;
  /** Repetição: ao concluir, a próxima ocorrência nasce com o prazo seguinte. */
  recurrence: TaskRecurrence | null;
  /** Subtarefa: id da tarefa-mãe (só um nível). `null` = tarefa principal. */
  parentId: string | null;
  /** Ordem manual (menor primeiro); `null` = ainda sem ordem manual. */
  position: number | null;
}

export type TaskPriority = 0 | 1 | 2 | 3;
export const TASK_PRIORITIES: readonly TaskPriority[] = [0, 1, 2, 3];
export const PRIORITY_LABEL: Record<TaskPriority, string> = { 0: 'Sem prioridade', 1: 'Baixa', 2: 'Média', 3: 'Alta' };

export const TASK_RECURRENCES = ['daily', 'weekdays', 'weekly', 'monthly'] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];
export const RECURRENCE_LABEL: Record<TaskRecurrence, string> = {
  daily: 'Todo dia',
  weekdays: 'Dias úteis',
  weekly: 'Toda semana',
  monthly: 'Todo mês',
};

/** Subtarefas por tarefa (limite de segurança). */
export const SUBTASK_LIMIT = 50;

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
  | 'invalid_source'
  | 'invalid_field'
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
  /**
   * Cria uma tarefa. Com `sourceRef`, é idempotente: se já existe uma tarefa (ativa ou concluída
   * ainda guardada) com a mesma origem, devolve ela em vez de criar outra.
   */
  create(
    title: string,
    dueAt?: string | null,
    sourceRef?: string | null,
    extra?: TaskExtra,
  ): Promise<TaskResult<Task>>;
  /** Define (ou remove, com `null`) o prazo. */
  setDue(id: string, dueAt: string | null): Promise<TaskResult<Task>>;
  /** Altera título, prioridade e/ou repetição (só os campos presentes). */
  update(id: string, patch: TaskPatch): Promise<TaskResult<Task>>;
  /** Ordem manual das tarefas principais ativas (ids na ordem desejada). */
  reorder(ids: string[]): Promise<TaskResult<null>>;
  /** Conclui; se repete, cria a próxima ocorrência. Concluir a principal conclui as subtarefas. */
  complete(id: string): Promise<TaskResult<Task>>;
  reopen(id: string): Promise<TaskResult<Task>>;
  /** Exclui a tarefa e as suas subtarefas. */
  remove(id: string): Promise<TaskResult<null>>;
}

/** Campos opcionais na criação. */
export interface TaskExtra {
  parentId?: string | null;
  priority?: number;
  recurrence?: string | null;
}

/** Campos editáveis (os ausentes não mudam). */
export interface TaskPatch {
  title?: string;
  priority?: number;
  recurrence?: string | null;
}

export function validatePriority(input: unknown): TaskResult<TaskPriority> {
  return input === 0 || input === 1 || input === 2 || input === 3
    ? ok(input)
    : fail('invalid_field', 'Prioridade inválida.');
}

export function validateRecurrence(input: unknown): TaskResult<TaskRecurrence | null> {
  if (input === null || input === undefined) return ok(null);
  return typeof input === 'string' && (TASK_RECURRENCES as readonly string[]).includes(input)
    ? ok(input as TaskRecurrence)
    : fail('invalid_field', 'Repetição inválida.');
}

/**
 * Próximo prazo de uma tarefa que se repete, mantendo a hora local, e SEMPRE depois de `now`
 * (se o app ficou fechado por dias, não gera ocorrências atrasadas em fila).
 */
export function nextDue(dueIso: string, recurrence: TaskRecurrence, now: Date = new Date()): string {
  const base = new Date(dueIso);
  const at = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes(), base.getSeconds());
  let cursor = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  let months = 0;
  for (let i = 0; i < 4000; i++) {
    let candidate: Date;
    if (recurrence === 'monthly') {
      months += 1;
      const first = new Date(base.getFullYear(), base.getMonth() + months, 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      // dia 31 em mês curto: usa o último dia do mês
      candidate = at(new Date(first.getFullYear(), first.getMonth(), Math.min(base.getDate(), last)));
    } else {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + (recurrence === 'weekly' ? 7 : 1));
      if (recurrence === 'weekdays') {
        while (cursor.getDay() === 0 || cursor.getDay() === 6) {
          cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
        }
      }
      candidate = at(cursor);
    }
    if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  }
  return base.toISOString();
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

/** Tamanho máximo da referência de origem (um id de evento da agenda cabe com folga). */
export const SOURCE_REF_MAX = 300;

/** Valida a origem: `null`/ausente = sem origem; senão um texto curto, sem caracteres de controle. */
export function validateSourceRef(input: unknown): TaskResult<string | null> {
  if (input === null || input === undefined) return ok(null);
  if (typeof input !== 'string') return fail('invalid_source', 'Origem da tarefa inválida.');
  const text = input.trim();
  // eslint-disable-next-line no-control-regex
  if (text.length === 0 || text.length > SOURCE_REF_MAX || /[\u0000-\u001f\u007f]/.test(text)) {
    return fail('invalid_source', 'Origem da tarefa inválida.');
  }
  return ok(text);
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
  /** `sourceRef` (ex.: id de um evento da agenda) torna a criação idempotente: não duplica. */
  create(
    title: string,
    dueAt?: string | null,
    sourceRef?: string | null,
    extra?: TaskExtra,
  ): Promise<TaskResult<Task>>;
  /** Altera título, prioridade e/ou repetição. */
  update(id: string, patch: TaskPatch): Promise<TaskResult<Task>>;
  /** Ordem manual das tarefas principais ativas. */
  reorder(ids: string[]): Promise<TaskResult<null>>;
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
  /**
   * Uma tarefa foi concluída agora (não dispara ao reabrir ou excluir). `reason` diz se foi uma tarefa
   * "difícil" (prioridade alta, atrasada, grande ou antiga), para uma comemoração maior.
   */
  onCompleted(listener: (reason: 'priority' | 'late' | 'subtasks' | 'old' | null) => void): () => void;
  /** Uma tarefa foi criada agora. */
  onCreated(listener: () => void): () => void;
  /** Chegou um lembrete de prazo. */
  onReminder(listener: (reminder: TaskReminder) => void): () => void;
}
