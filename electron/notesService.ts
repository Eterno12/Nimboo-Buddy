import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import { IPC } from '../shared/ipc';
import {
  isNoteId,
  noteFail,
  type Note,
  type NoteChange,
  type NoteResult,
  type NoteSummary,
} from '../shared/notes';
import { createNotesWindow, createNoteWindow } from './windows';
import { SqliteNotesRepository } from './notes/sqliteNotesRepository';

export interface NotesService {
  /** Abre (ou traz à frente) a janela de notas, opcionalmente numa nota. */
  openManager(id?: string | null): void;
  close(): void;
}

interface NotesServiceOptions {
  db: DatabaseSync;
  /** URL de origem das páginas do app (servidor de desenvolvimento) ou `file://`. */
  isAppUrl(url: string): boolean;
  /** O tema escuro está em uso (para a janela nascer com o fundo certo). */
  isDark(): boolean;
}

const CHANNELS = [IPC.notesList, IPC.notesGet, IPC.notesCreate, IPC.notesUpdate, IPC.notesRemove];
const DEFAULT_SIZE = { width: 320, height: 300 };
const BOUNDS_SAVE_DELAY_MS = 500;

/**
 * Notas: IPC tipado sobre o repositório SQLite + as janelas flutuantes (uma por nota fixada) e a janela
 * de gerenciamento. Só o processo principal toca o banco; as janelas recebem a mudança por evento.
 */
export function startNotesService({ db, isAppUrl, isDark }: NotesServiceOptions): NotesService {
  const floating = new Map<string, BrowserWindow>();
  /** Janelas que o próprio serviço está fechando (não devem desafixar a nota). */
  const closing = new Set<string>();
  let manager: BrowserWindow | null = null;
  let disposed = false;

  const broadcast = (change: NoteChange) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.notesChanged, change);
      } catch (error) {
        console.error('Falha ao avisar uma janela sobre mudanças nas notas:', error);
      }
    }
  };

  const repo = new SqliteNotesRepository(db, {
    onChange: (change) => {
      broadcast(change);
      if (change.type === 'removed') closeFloating(change.id);
      else if (change.type === 'updated' && change.fields.includes('pinned')) void syncFloating(change.id);
    },
  });

  /** Posição inicial de uma nota fixada pela 1ª vez: canto superior direito, em cascata. */
  const defaultBounds = () => {
    const area = screen.getPrimaryDisplay().workArea;
    const n = floating.size;
    return {
      x: Math.max(area.x, area.x + area.width - DEFAULT_SIZE.width - 24 - n * 28),
      y: area.y + 24 + n * 28,
      ...DEFAULT_SIZE,
    };
  };

  /** A posição salva ainda cabe em algum monitor? Senão volta ao padrão. */
  const visibleBounds = (b: { x: number; y: number; width: number; height: number } | null) => {
    if (!b) return defaultBounds();
    const inside = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x + 40 < a.x + a.width && b.x + b.width - 40 > a.x && b.y + 20 < a.y + a.height && b.y > a.y - 20;
    });
    return inside ? b : defaultBounds();
  };

  function closeFloating(id: string): void {
    const win = floating.get(id);
    if (!win) return;
    floating.delete(id);
    closing.add(id);
    if (!win.isDestroyed()) win.close();
  }

  function openFloating(note: Note): void {
    const existing = floating.get(note.id);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }
    const win = createNoteWindow(note.id, note.color, visibleBounds(note.bounds));
    floating.set(note.id, win);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saveBounds = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (disposed || win.isDestroyed() || win.isMinimized()) return;
        void repo.update(note.id, { bounds: win.getBounds() });
      }, BOUNDS_SAVE_DELAY_MS);
    };
    win.on('moved', saveBounds);
    win.on('resized', saveBounds);
    win.on('closed', () => {
      clearTimeout(timer);
      if (floating.get(note.id) === win) floating.delete(note.id);
      const programmatic = closing.delete(note.id);
      // Fechada por outro meio (Alt+F4...): a nota deixa de ser flutuante, mas continua guardada.
      if (!programmatic && !disposed) void repo.update(note.id, { pinned: false });
    });
  }

  async function syncFloating(id: string): Promise<void> {
    const r = await repo.get(id);
    if (!r.ok) return closeFloating(id);
    if (r.value.pinned) openFloating(r.value);
    else closeFloating(id);
  }

  // Ao iniciar, reabre as notas que estavam flutuantes.
  void repo
    .pinned()
    .then((notes) => notes.forEach(openFloating))
    .catch((error) => console.error('Falha ao reabrir as notas flutuantes:', error));

  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };

  const guarded = <T>(channel: string, op: (...args: unknown[]) => Promise<NoteResult<T>>) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<NoteResult<T>> => {
      if (!trusted(event)) return noteFail('storage', 'Remetente não autorizado.');
      try {
        return await op(...args);
      } catch (error) {
        console.error(`Falha em ${channel}:`, error);
        return noteFail('storage', 'Não foi possível acessar as notas salvas.');
      }
    });
  };

  guarded<NoteSummary[]>(IPC.notesList, async (query) => {
    const value = await repo.list(typeof query === 'string' ? query : undefined);
    return { ok: true, value };
  });
  guarded<Note>(IPC.notesGet, (id) => repo.get(id as string));
  guarded<Note>(IPC.notesCreate, (input) =>
    repo.create(typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as object) : {}),
  );
  guarded<Note>(IPC.notesUpdate, (id, patch) =>
    repo.update(id as string, typeof patch === 'object' && patch !== null && !Array.isArray(patch) ? (patch as object) : {}),
  );
  guarded<null>(IPC.notesRemove, (id) => repo.remove(id as string));

  const openManager = (id?: string | null) => {
    const target = isNoteId(id) ? id : null;
    if (manager && !manager.isDestroyed()) {
      if (manager.isMinimized()) manager.restore();
      manager.show();
      manager.focus();
      if (target) manager.webContents.send(IPC.notesOpen, target);
      return;
    }
    manager = createNotesWindow(target, isDark());
    manager.on('closed', () => {
      manager = null;
    });
  };

  const onOpenManager = (event: IpcMainEvent, id: unknown) => {
    if (trusted(event)) openManager(typeof id === 'string' ? id : null);
  };
  ipcMain.on(IPC.notesOpenManager, onOpenManager);

  return {
    openManager,
    close() {
      disposed = true;
      for (const channel of CHANNELS) ipcMain.removeHandler(channel);
      ipcMain.removeListener(IPC.notesOpenManager, onOpenManager);
      for (const win of floating.values()) {
        if (!win.isDestroyed()) win.destroy();
      }
      floating.clear();
    },
  };
}
