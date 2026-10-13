import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import {
  fail,
  isTaskId,
  ok,
  type PendingRemoval,
  type Task,
  type TaskChange,
  type TaskResult,
  type TaskSnapshot,
} from '../shared/tasks';
import { openDatabaseDetailed } from './tasks/database';
import { SchemaTooNewError } from './tasks/migrations';
import { SqliteTaskRepository } from './tasks/sqliteTaskRepository';
import { RemovalScheduler } from './tasks/removalScheduler';
import type { DatabaseSync } from 'node:sqlite';

/** A limpeza das concluídas também roda de hora em hora enquanto o app está aberto. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export interface TasksService {
  /** Conexão aberta (para outros registros no mesmo arquivo, como as sessões de foco) ou null. */
  database(): DatabaseSync | null;
  close(): void;
}

interface TasksServiceOptions {
  dbPath: string;
  /** URL de origem das páginas do app (servidor de desenvolvimento) ou `file://`. */
  isAppUrl(url: string): boolean;
  /** Chamado ao abrir e a cada mudança, com as tarefas visíveis (usado pelos lembretes de prazo). */
  onTasksChanged?(tasks: Task[]): void;
}

const STORAGE_DOWN = () => fail<never>('storage', 'As tarefas não estão disponíveis agora.');

const CHANNELS = [
  IPC.tasksList,
  IPC.tasksCreate,
  IPC.tasksComplete,
  IPC.tasksReopen,
  IPC.tasksScheduleRemove,
  IPC.tasksUndoRemove,
  IPC.tasksSetDue,
  IPC.tasksNotice,
  IPC.tasksDismissNotice,
];

/**
 * Liga o repositório SQLite ao IPC. O banco só existe no processo principal; o
 * renderer chama operações específicas e tipadas, e é avisado das mudanças.
 */
export function startTasksService({ dbPath, isAppUrl, onTasksChanged }: TasksServiceOptions): TasksService {
  let db: DatabaseSync | null = null;
  let repo: SqliteTaskRepository | null = null;
  let scheduler: RemovalScheduler | null = null;
  /** Aviso ao usuário sobre o armazenamento (arquivo recuperado, banco de versão mais nova, falha). */
  let notice: string | null = null;

  /**
   * Avisa todas as janelas. Cada envio é isolado: uma janela com problema não
   * impede as demais de atualizar (nem afeta a operação já confirmada).
   * "Concluída" é um evento à parte: só ela faz o Mochi comemorar.
   */
  const broadcast = (change?: TaskChange) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.tasksChanged);
        if (change?.type === 'completed') win.webContents.send(IPC.tasksCompleted);
        if (change?.type === 'created') win.webContents.send(IPC.tasksCreated);
      } catch (error) {
        console.error('Falha ao avisar uma janela sobre mudanças nas tarefas:', error);
      }
    }
    publish();
  };

  /** Entrega as tarefas visíveis a quem agenda lembretes (nunca falha a operação já confirmada). */
  const publish = () => {
    if (!onTasksChanged || !repo || !scheduler) return;
    const currentRepo = repo;
    const currentScheduler = scheduler;
    void currentRepo
      .list()
      .then((lists) => onTasksChanged(currentScheduler.snapshot(lists).active))
      .catch((error) => console.error('Falha ao publicar as tarefas:', error));
  };

  try {
    const opened = openDatabaseDetailed(dbPath);
    db = opened.db;
    if (opened.recoveredFrom) {
      notice =
        'O arquivo das suas tarefas estava danificado e foi guardado à parte. Começamos uma lista nova; ' +
        'se precisar das tarefas antigas, a cópia está na pasta de dados do Mochi.';
    }
    repo = new SqliteTaskRepository(db, { onChange: (c) => broadcast(c) });
    scheduler = new RemovalScheduler(repo, { onChange: () => broadcast() });
    repo.purgeExpired(); // limpeza na inicialização
    publish();
  } catch (error) {
    // O app segue funcionando (mascote, ilha); só as tarefas ficam indisponíveis.
    console.error('Não foi possível abrir o banco de tarefas:', error);
    notice =
      error instanceof SchemaTooNewError
        ? 'Suas tarefas foram criadas por uma versão mais nova do Mochi. Atualize o app para usá-las.'
        : 'Não foi possível abrir suas tarefas agora. Elas continuam salvas; tente reiniciar o Mochi.';
    try {
      db?.close();
    } catch {
      /* já fechado */
    }
    db = null;
    repo = null;
    scheduler = null;
  }

  const timer = setInterval(() => {
    try {
      repo?.purgeExpired();
    } catch (error) {
      console.error('Falha na limpeza periódica de tarefas:', error);
    }
  }, PURGE_INTERVAL_MS);
  timer.unref();

  /** Só o quadro principal de uma janela do próprio app pode usar o banco. */
  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };

  interface Ctx {
    repo: SqliteTaskRepository;
    scheduler: RemovalScheduler;
  }

  /** Executa uma operação com validação do remetente (os argumentos são validados pelo repositório). */
  const handle = <R>(channel: string, op: (ctx: Ctx, arg: unknown, ...rest: unknown[]) => Promise<TaskResult<R>>) => {
    ipcMain.handle(channel, async (event, arg: unknown, ...rest: unknown[]): Promise<TaskResult<R>> => {
      if (!trusted(event)) return fail('storage', 'Remetente não autorizado.');
      if (!repo || !scheduler) return STORAGE_DOWN();
      try {
        return await op({ repo, scheduler }, arg, ...rest);
      } catch (error) {
        console.error(`Falha em ${channel}:`, error);
        return fail('storage', 'Não foi possível acessar as tarefas salvas.');
      }
    });
  };

  /** Uma tarefa com exclusão agendada já "não existe" para as demais operações. */
  const gone = <T>(ctx: Ctx, id: unknown): TaskResult<T> | null =>
    isTaskId(id) && ctx.scheduler.isPending(id) ? fail('not_found', 'A tarefa foi excluída.') : null;

  handle<TaskSnapshot>(IPC.tasksList, async ({ repo: r, scheduler: s }) => ok(s.snapshot(await r.list())));
  // Aceita só o título (texto) ou { title, dueAt }; tudo é validado pelo repositório.
  handle<Task>(IPC.tasksCreate, ({ repo: r }, arg) => {
    if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
      const { title, dueAt } = arg as { title?: unknown; dueAt?: unknown };
      return r.create(title as string, (dueAt ?? null) as string | null);
    }
    return r.create(arg as string);
  });
  handle<Task>(IPC.tasksSetDue, async (ctx, id, dueAt) =>
    gone<Task>(ctx, id) ?? ctx.repo.setDue(id as string, (dueAt ?? null) as string | null),
  );
  handle<Task>(IPC.tasksComplete, async (ctx, id) => gone<Task>(ctx, id) ?? ctx.repo.complete(id as string));
  handle<Task>(IPC.tasksReopen, async (ctx, id) => gone<Task>(ctx, id) ?? ctx.repo.reopen(id as string));
  handle<PendingRemoval>(IPC.tasksScheduleRemove, ({ scheduler: s }, id) => s.schedule(id as string));
  handle<Task>(IPC.tasksUndoRemove, ({ scheduler: s }, id) => s.undo(id as string));

  ipcMain.handle(IPC.tasksNotice, (event): string | null => (trusted(event) ? notice : null));
  ipcMain.handle(IPC.tasksDismissNotice, (event): void => {
    if (trusted(event)) notice = null;
  });

  return {
    database: () => db,
    close() {
      clearInterval(timer);
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      // Exclusões ainda no prazo são canceladas: nada é apagado antes do tempo.
      scheduler?.dispose();
      try {
        db?.close(); // fecha a conexão (e faz o checkpoint do WAL)
      } catch (error) {
        console.error('Falha ao fechar o banco de tarefas:', error);
      }
      db = null;
      repo = null;
      scheduler = null;
    },
  };
}
