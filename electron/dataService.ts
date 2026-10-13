import fs from 'node:fs';
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import { IPC } from '../shared/ipc';
import { SqliteNotesRepository } from './notes/sqliteNotesRepository';
import { SqliteTaskRepository } from './tasks/sqliteTaskRepository';
import { IMPORT_MAX_BYTES, applyImport, buildExport, parseExportFile } from './data/portability';

export interface DataResult {
  ok: boolean;
  message: string;
}

interface DataServiceOptions {
  database(): DatabaseSync | null;
  isAppUrl(url: string): boolean;
}

export interface DataService {
  close(): void;
}

/**
 * Exportar e importar os dados (tarefas e notas) como um arquivo JSON, pelo diálogo do Windows.
 * Só o processo principal lê/grava arquivos; o renderer só pede a operação.
 */
export function startDataService({ database, isAppUrl }: DataServiceOptions): DataService {
  const trusted = (event: IpcMainInvokeEvent): BrowserWindow | null => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    if (event.senderFrame !== event.sender.mainFrame) return null;
    return isAppUrl(event.senderFrame?.url ?? '') ? win : null;
  };

  const notifyAll = () => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      try {
        w.webContents.send(IPC.tasksChanged);
        w.webContents.send(IPC.notesChanged, { type: 'updated', id: '', fields: [] });
      } catch {
        /* janela fechando */
      }
    }
  };

  ipcMain.handle(IPC.dataExport, async (event): Promise<DataResult> => {
    const win = trusted(event);
    const db = database();
    if (!win || !db) return { ok: false, message: 'Os dados não estão disponíveis agora.' };
    const stamp = new Date().toISOString().slice(0, 10);
    const choice = await dialog.showSaveDialog(win, {
      title: 'Exportar tarefas e notas',
      defaultPath: `mochi-backup-${stamp}.json`,
      filters: [{ name: 'Backup do Mochi (JSON)', extensions: ['json'] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: false, message: 'Exportação cancelada.' };
    try {
      const data = await buildExport(new SqliteTaskRepository(db), new SqliteNotesRepository(db));
      fs.writeFileSync(choice.filePath, JSON.stringify(data, null, 2), 'utf8');
      return {
        ok: true,
        message: `Exportei ${data.tasks.length} tarefa(s) e ${data.notes.length} nota(s).`,
      };
    } catch (error) {
      console.error('Falha ao exportar:', error);
      return { ok: false, message: 'Não consegui gravar o arquivo.' };
    }
  });

  ipcMain.handle(IPC.dataImport, async (event): Promise<DataResult> => {
    const win = trusted(event);
    const db = database();
    if (!win || !db) return { ok: false, message: 'Os dados não estão disponíveis agora.' };
    const choice = await dialog.showOpenDialog(win, {
      title: 'Importar tarefas e notas',
      properties: ['openFile'],
      filters: [{ name: 'Backup do Mochi (JSON)', extensions: ['json'] }],
    });
    if (choice.canceled || choice.filePaths.length === 0) return { ok: false, message: 'Importação cancelada.' };
    try {
      const file = choice.filePaths[0];
      if (fs.statSync(file).size > IMPORT_MAX_BYTES) return { ok: false, message: 'Esse arquivo é grande demais.' };
      const parsed = parseExportFile(fs.readFileSync(file, 'utf8'));
      if (!parsed) return { ok: false, message: 'Esse arquivo não é um backup do Mochi.' };
      const s = await applyImport(parsed, new SqliteTaskRepository(db), new SqliteNotesRepository(db));
      notifyAll();
      const parts = [`${s.tasksAdded} tarefa(s) e ${s.notesAdded} nota(s) importadas`];
      const skipped = s.tasksSkipped + s.notesSkipped;
      if (skipped > 0) parts.push(`${skipped} já existiam`);
      if (s.invalid > 0) parts.push(`${s.invalid} ignorada(s) por inválidas`);
      return { ok: true, message: `${parts.join('; ')}.` };
    } catch (error) {
      console.error('Falha ao importar:', error);
      return { ok: false, message: 'Não consegui ler o arquivo.' };
    }
  });

  return {
    close() {
      ipcMain.removeHandler(IPC.dataExport);
      ipcMain.removeHandler(IPC.dataImport);
    },
  };
}
