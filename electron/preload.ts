import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type CursorPoint, type MochiApi, type SettingsSnapshot } from '../shared/ipc';
import type { Entrance, PresentationState } from '../shared/presentation';
import type { FocusKind, FocusState } from '../shared/focus';
import { EMPTY_CALENDAR, type CalendarState } from '../shared/calendar';
import type { BondSnapshot } from '../shared/achievements';

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
    create: (title, dueAt, sourceRef, extra) =>
      ipcRenderer.invoke(IPC.tasksCreate, { title, dueAt: dueAt ?? null, sourceRef: sourceRef ?? null, extra: extra ?? {} }),
    setDue: (id, dueAt) => ipcRenderer.invoke(IPC.tasksSetDue, id, dueAt),
    update: (id, patch) => ipcRenderer.invoke(IPC.tasksUpdate, id, patch),
    reorder: (ids) => ipcRenderer.invoke(IPC.tasksReorder, ids),
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
    onCompleted: (listener) =>
      listen<[unknown]>(IPC.tasksCompleted, (reason) =>
        listener(reason === 'priority' || reason === 'late' || reason === 'subtasks' || reason === 'old' ? reason : null),
      ),
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
  bond: {
    get: () => ipcRenderer.invoke(IPC.bondGet),
    week: () => ipcRenderer.invoke(IPC.statsWeek),
    event: (type) => ipcRenderer.send(IPC.bondEvent, { type }),
    saveAffection: (value) => ipcRenderer.send(IPC.bondSaveAffection, value),
    open: () => ipcRenderer.send(IPC.bondOpen),
    onChange: (listener) => listen<[BondSnapshot]>(IPC.bondChanged, (s) => listener(s)),
  },
  data: {
    export: () => ipcRenderer.invoke(IPC.dataExport),
    import: () => ipcRenderer.invoke(IPC.dataImport),
  },
  assistant: {
    open: () => ipcRenderer.send(IPC.assistantOpen),
    listen: () => ipcRenderer.invoke(IPC.assistantListen),
    cancelListen: () => ipcRenderer.send(IPC.assistantListenCancel),
    openSpeechSettings: () => ipcRenderer.send(IPC.assistantOpenSpeechSettings),
    ask: (question, history) => ipcRenderer.invoke(IPC.assistantAsk, question, history),
    status: () => ipcRenderer.invoke(IPC.assistantAiStatus),
    pullModel: (model) => ipcRenderer.invoke(IPC.assistantPullModel, model ?? null),
    onPullProgress: (listener) =>
      listen<[{ status?: unknown; fraction?: unknown }]>(IPC.assistantPullProgress, (p) =>
        listener({ status: typeof p?.status === 'string' ? p.status : '', fraction: typeof p?.fraction === 'number' ? p.fraction : null }),
      ),
  },
  notes: {
    list: (query) => ipcRenderer.invoke(IPC.notesList, query ?? null),
    get: (id) => ipcRenderer.invoke(IPC.notesGet, id),
    create: (input) => ipcRenderer.invoke(IPC.notesCreate, input ?? {}),
    update: (id, patch) => ipcRenderer.invoke(IPC.notesUpdate, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.notesRemove, id),
    openManager: (id) => ipcRenderer.send(IPC.notesOpenManager, id ?? null),
    onChange: (listener) =>
      listen<[{ type?: unknown; id?: unknown; fields?: unknown }]>(IPC.notesChanged, (c) => {
        const type = c?.type === 'created' || c?.type === 'updated' || c?.type === 'removed' ? c.type : 'updated';
        const id = typeof c?.id === 'string' ? c.id : '';
        const fields = Array.isArray(c?.fields) ? c.fields.filter((f): f is 'doc' | 'color' | 'pinned' | 'bounds' => ['doc', 'color', 'pinned', 'bounds'].includes(f as string)) : [];
        listener(type === 'updated' ? { type, id, fields } : { type, id });
      }),
    onOpen: (listener) => listen<[unknown]>(IPC.notesOpen, (id) => listener(typeof id === 'string' ? id : null)),
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
