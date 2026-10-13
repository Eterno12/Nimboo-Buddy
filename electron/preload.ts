import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CursorPoint, type MochiApi } from '../shared/ipc';
import type { Entrance, PresentationState } from '../shared/presentation';

/** Sanitiza o que vem do main antes de entregar à página. */
function asPresentation(value: unknown): PresentationState {
  const v = (value ?? {}) as { mode?: unknown; entrance?: { kind?: unknown; from?: unknown } | null };
  let entrance: Entrance = null;
  if (v.entrance?.kind === 'drop') entrance = { kind: 'drop' };
  else if (v.entrance?.kind === 'slide') {
    entrance = { kind: 'slide', from: v.entrance.from === 'left' ? 'left' : 'right' };
  }
  return { mode: v.mode === 'island' ? 'island' : 'floating', entrance };
}

/** Registra um ouvinte de evento do main e devolve a função que o remove. */
function listen<A extends unknown[]>(channel: string, handler: (...args: A) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => handler(...(args as A));
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: MochiApi = {
  startDrag: () => ipcRenderer.send(IPC.dragStart),
  moveDrag: () => ipcRenderer.send(IPC.dragMove),
  endDrag: () => ipcRenderer.send(IPC.dragEnd),
  showMenu: () => ipcRenderer.send(IPC.showMenu),
  // Não repassa o objeto `event` do Electron à página.
  onCursor: (listener) =>
    listen<[CursorPoint]>(IPC.cursor, (point) => listener({ x: Number(point.x), y: Number(point.y) })),
  getPresentation: async () => asPresentation(await ipcRenderer.invoke(IPC.getPresentation)),
  onPresentationChange: (listener) =>
    listen<[unknown]>(IPC.presentationChanged, (state) => listener(asPresentation(state))),
  presentationApplied: () => ipcRenderer.send(IPC.presentationApplied),
  islandOpen: async () => {
    await ipcRenderer.invoke(IPC.islandOpen);
  },
  islandExtent: async (extent) => {
    await ipcRenderer.invoke(IPC.islandExtent, extent);
  },
  islandClosed: () => ipcRenderer.send(IPC.islandClosed),
  tasks: {
    list: () => ipcRenderer.invoke(IPC.tasksList),
    create: (title) => ipcRenderer.invoke(IPC.tasksCreate, title),
    complete: (id) => ipcRenderer.invoke(IPC.tasksComplete, id),
    reopen: (id) => ipcRenderer.invoke(IPC.tasksReopen, id),
    scheduleRemove: (id) => ipcRenderer.invoke(IPC.tasksScheduleRemove, id),
    undoRemove: (id) => ipcRenderer.invoke(IPC.tasksUndoRemove, id),
    onChange: (listener) => listen<[]>(IPC.tasksChanged, () => listener()),
    onCompleted: (listener) => listen<[]>(IPC.tasksCompleted, () => listener()),
  },
  islandHidden: () => ipcRenderer.send(IPC.islandHidden),
  onLeave: (listener) => listen<[]>(IPC.leave, () => listener()),
  leaveDone: () => ipcRenderer.send(IPC.leaveDone),
  onIslandToggle: (listener) => listen<[]>(IPC.islandToggle, () => listener()),
};

contextBridge.exposeInMainWorld('mochi', api);
