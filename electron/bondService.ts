import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import { IPC } from '../shared/ipc';
import { ALL_ACHIEVEMENTS, type BondEvent, type BondSnapshot } from '../shared/achievements';
import { BondEngine } from './bond/bondEngine';
import { SqliteBondStore } from './bond/bondStore';
import { queryWeek } from './stats/statsQuery';
import { createAchievementsWindow, createToastWindow } from './windows';

export interface BondService {
  /** Evento nascido no processo principal (tarefa concluída, nota criada, foco, personagem...). */
  record(event: BondEvent): void;
  snapshot(): BondSnapshot;
  /** A sincronização trouxe conquistas/acessórios de outro aparelho: relê e avisa as janelas. */
  reload(): void;
  openWindow(): void;
  close(): void;
}

interface BondServiceOptions {
  db: DatabaseSync;
  isAppUrl(url: string): boolean;
  isDark(): boolean;
  /** Pode mostrar o aviso agora? (falso com app em tela cheia: "não incomodar"). */
  canToast(): boolean;
}

const TOAST_MS = 5600;
/** Entre um aviso e o próximo (a animação de saída termina antes de o seguinte entrar). */
const TOAST_GAP_MS = 500;
/** Afeto salvo no máximo uma vez a cada tanto (a interface manda a cada minuto). */
const CHANNELS = [IPC.bondGet, IPC.statsWeek, IPC.bondBuySkin];

export function startBondService({ db, isAppUrl, isDark, canToast }: BondServiceOptions): BondService {
  let win: BrowserWindow | null = null;
  const queue: string[] = [];
  let showing = false;
  let disposed = false;

  const broadcast = (snapshot: BondSnapshot) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      try {
        w.webContents.send(IPC.bondChanged, snapshot);
      } catch {
        /* janela fechando */
      }
    }
  };

  const nextToast = () => {
    if (disposed || showing) return;
    const id = queue.shift();
    if (!id) return;
    if (!canToast()) {
      queue.length = 0; // com tela cheia, os avisos se perdem de propósito (a conquista continua valendo)
      return;
    }
    showing = true;
    const area = screen.getPrimaryDisplay().workArea;
    const toast = createToastWindow(id, area);
    const done = () => {
      if (!toast.isDestroyed()) toast.destroy();
      setTimeout(() => {
        showing = false;
        nextToast();
      }, TOAST_GAP_MS);
    };
    setTimeout(done, TOAST_MS);
    toast.once('closed', () => undefined);
  };

  const engine = new BondEngine({
    store: new SqliteBondStore(db),
    onChanged: broadcast,
    onUnlocked: (ids) => {
      for (const id of ids) if (ALL_ACHIEVEMENTS.some((a) => a.id === id)) queue.push(id);
      nextToast();
    },
  });

  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || w.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };

  ipcMain.handle(IPC.bondGet, (event) => (trusted(event) ? engine.snapshot() : null));
  ipcMain.handle(IPC.bondBuySkin, (event, id: unknown) => (trusted(event) ? engine.buySkin(id) : null));
  ipcMain.handle(IPC.statsWeek, (event) => {
    if (!trusted(event)) return null;
    try {
      return queryWeek(db);
    } catch (error) {
      console.error('Falha ao ler as estatísticas da semana:', error);
      return null;
    }
  });
  const onEvent = (event: IpcMainEvent, raw: unknown) => {
    if (trusted(event)) engine.handleFromRenderer(raw);
  };
  const onAffection = (event: IpcMainEvent, value: unknown) => {
    if (trusted(event)) engine.saveAffection(value);
  };
  const openWindow = () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    win = createAchievementsWindow(isDark());
    win.on('closed', () => {
      win = null;
    });
  };
  const onOpen = (event: IpcMainEvent) => {
    if (trusted(event)) openWindow();
  };
  ipcMain.on(IPC.bondEvent, onEvent);
  ipcMain.on(IPC.bondSaveAffection, onAffection);
  ipcMain.on(IPC.bondOpen, onOpen);

  return {
    record: (event) => {
      engine.handle(event);
    },
    snapshot: () => engine.snapshot(),
    reload: () => engine.reload(),
    openWindow,
    close() {
      disposed = true;
      for (const c of CHANNELS) ipcMain.removeHandler(c);
      ipcMain.removeListener(IPC.bondEvent, onEvent);
      ipcMain.removeListener(IPC.bondSaveAffection, onAffection);
      ipcMain.removeListener(IPC.bondOpen, onOpen);
      if (win && !win.isDestroyed()) win.destroy();
    },
  };
}
