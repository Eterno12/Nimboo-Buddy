import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CursorPoint, type MochiApi, type SettingsSnapshot } from '../shared/ipc';
import type { Entrance, PresentationState } from '../shared/presentation';
import type { FocusKind, FocusState } from '../shared/focus';
import { EMPTY_CALENDAR, type CalendarState } from '../shared/calendar';

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
    create: (title, dueAt) => ipcRenderer.invoke(IPC.tasksCreate, { title, dueAt: dueAt ?? null }),
    setDue: (id, dueAt) => ipcRenderer.invoke(IPC.tasksSetDue, id, dueAt),
    complete: (id) => ipcRenderer.invoke(IPC.tasksComplete, id),
    reopen: (id) => ipcRenderer.invoke(IPC.tasksReopen, id),
    scheduleRemove: (id) => ipcRenderer.invoke(IPC.tasksScheduleRemove, id),
    undoRemove: (id) => ipcRenderer.invoke(IPC.tasksUndoRemove, id),
    notice: async () => {
      const value = await ipcRenderer.invoke(IPC.tasksNotice);
      return typeof value === 'string' ? value : null;
    },
    dismissNotice: async () => {
      await ipcRenderer.invoke(IPC.tasksDismissNotice);
    },
    onChange: (listener) => listen<[]>(IPC.tasksChanged, () => listener()),
    onCompleted: (listener) => listen<[]>(IPC.tasksCompleted, () => listener()),
    onCreated: (listener) => listen<[]>(IPC.tasksCreated, () => listener()),
    onReminder: (listener) =>
      listen<[unknown]>(IPC.tasksReminder, (raw) => {
        // Sanitiza o que vem do main antes de entregar à página.
        const r = (raw ?? {}) as Record<string, unknown>;
        if (typeof r.title !== 'string' || (r.kind !== 'soon' && r.kind !== 'due')) return;
        listener({
          taskId: String(r.taskId ?? ''),
          title: r.title,
          kind: r.kind,
          dueAt: String(r.dueAt ?? ''),
          minutes: Number.isFinite(r.minutes) ? Number(r.minutes) : 0,
        });
      }),
  },
  focus: {
    getState: () => ipcRenderer.invoke(IPC.focusGet),
    start: (kind, minutes, task) => ipcRenderer.invoke(IPC.focusStart, kind, minutes, task ?? null),
    stats: () => ipcRenderer.invoke(IPC.focusStats),
    pause: () => ipcRenderer.invoke(IPC.focusPause),
    resume: () => ipcRenderer.invoke(IPC.focusResume),
    cancel: () => ipcRenderer.invoke(IPC.focusCancel),
    onChange: (listener) => listen<[FocusState]>(IPC.focusChanged, (state) => listener(state)),
    onFinished: (listener) => listen<[FocusKind]>(IPC.focusFinished, (kind) => listener(kind)),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    onChange: (listener) => listen<[SettingsSnapshot]>(IPC.settingsChanged, (s) => listener(s)),
  },
  calendar: {
    get: async () => (await ipcRenderer.invoke(IPC.calendarGet)) ?? EMPTY_CALENDAR,
    setUrl: (url) => ipcRenderer.invoke(IPC.calendarSetUrl, url),
    clear: async () => (await ipcRenderer.invoke(IPC.calendarClear)) ?? EMPTY_CALENDAR,
    refresh: async () => (await ipcRenderer.invoke(IPC.calendarRefresh)) ?? EMPTY_CALENDAR,
    onChange: (listener) => listen<[CalendarState]>(IPC.calendarChanged, (s) => listener(s)),
  },
  bubbleVisible: (visible) => ipcRenderer.send(IPC.bubbleVisible, visible === true),
  onSummon: (listener) => listen<[]>(IPC.islandSummon, () => listener()),
  openSettings: () => ipcRenderer.send(IPC.panelOpenSettings),
  panel: {
    initialView: async () => ((await ipcRenderer.invoke(IPC.panelInitialView)) === 'settings' ? 'settings' : 'home'),
    onNavigate: (listener) =>
      listen<[unknown]>(IPC.panelNavigate, (view) => listener(view === 'settings' ? 'settings' : 'home')),
  },
  islandHiding: () => ipcRenderer.send(IPC.islandHiding),
  islandHidden: () => ipcRenderer.send(IPC.islandHidden),
  onLeave: (listener) => listen<[]>(IPC.leave, () => listener()),
  leaveDone: () => ipcRenderer.send(IPC.leaveDone),
  onIslandToggle: (listener) => listen<[]>(IPC.islandToggle, () => listener()),
};

contextBridge.exposeInMainWorld('mochi', api);
