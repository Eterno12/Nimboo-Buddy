import type { IslandExtent, PresentationState } from './presentation';
import type { TasksApi } from './tasks';
import type { NotesApi } from './notes';
import type { AssistantApi } from './assistantApi';
import type { BondSnapshot } from './achievements';
import type { WeekStats } from './stats';
import type { FocusApi } from './focus';
import type { Settings } from './settings';
import type { CalendarResult, CalendarState } from './calendar';

/** Preferências + o que só o processo principal sabe (para a tela de configurações). */
export interface SettingsSnapshot {
  settings: Settings;
  /** App instalado: só então "iniciar com o Windows" tem efeito. */
  packaged: boolean;
  /** O atalho global escolhido foi registrado (outro app pode já usá-lo). */
  shortcutActive: boolean;
  /** Fatores realmente aplicados (o pedido, limitado ao que cabe no monitor). */
  effective: { islandScale: number; mochiScale: number };
}

/** Telas do painel que podem ser abertas de fora (menu da bandeja, engrenagem da ilha). */
export type PanelView = 'home' | 'settings';

/** Contrato único entre main, preload e renderer. */
export const IPC = {
  dragStart: 'mascot:drag-start',
  dragMove: 'mascot:drag-move',
  dragEnd: 'mascot:drag-end',
  showMenu: 'mascot:show-menu',
  /** main -> renderer: posição do cursor relativa à janela do mascote. */
  cursor: 'mascot:cursor',
  /** renderer -> main (invoke): apresentação atual (e a entrada pendente, uma única vez). */
  getPresentation: 'presentation:get',
  /** main -> renderer: a apresentação mudou. */
  presentationChanged: 'presentation:changed',
  /** renderer -> main (invoke): ajusta até onde a forma da ilha aberta se estende. */
  islandExtent: 'island:extent',
  /** renderer -> main (invoke): operações de tarefas (cada uma é específica e tipada). */
  bondGet: 'bond:get',
  bondEvent: 'bond:event',
  bondSaveAffection: 'bond:save-affection',
  bondOpen: 'bond:open',
  /** renderer -> main (invoke): estatísticas da semana (foco e tarefas por dia). */
  statsWeek: 'stats:week',
  /** main -> renderer: o vinculo/conquistas mudou (snapshot). */
  bondChanged: 'bond:changed',
  dataExport: 'data:export',
  dataImport: 'data:import',
  assistantOpen: 'assistant:open',
  assistantHistoryList: 'assistant:history-list',
  assistantHistoryAdd: 'assistant:history-add',
  assistantHistoryClear: 'assistant:history-clear',
  assistantStartListen: 'assistant:start-listen',
  assistantTakePendingListen: 'assistant:take-pending-listen',
  geminiStatus: 'gemini:status',
  geminiSetKey: 'gemini:set-key',
  geminiClearKey: 'gemini:clear-key',
  geminiTest: 'gemini:test',
  geminiOpenKeyPage: 'gemini:open-key-page',
  geminiChat: 'gemini:chat',
  geminiChatCancel: 'gemini:chat-cancel',
  /** main -> assistente: pedaço novo da resposta ({ requestId, delta }). */
  geminiChatDelta: 'gemini:chat-delta',
  assistantListen: 'assistant:listen',
  assistantListenCancel: 'assistant:listen-cancel',
  assistantOpenSpeechSettings: 'assistant:open-speech-settings',
  assistantAsk: 'assistant:ask',
  assistantAiStatus: 'assistant:ai-status',
  assistantPullModel: 'assistant:pull-model',
  /** main -> assistente: progresso do download de modelo ({ status, fraction }). */
  assistantPullProgress: 'assistant:pull-progress',
  notesList: 'notes:list',
  notesGet: 'notes:get',
  notesCreate: 'notes:create',
  notesUpdate: 'notes:update',
  notesRemove: 'notes:remove',
  /** main -> renderer: uma nota mudou ({ type, id, fields? }). */
  notesChanged: 'notes:changed',
  /** renderer -> main: abrir a janela de notas (opcionalmente em uma nota). */
  notesOpenManager: 'notes:open-manager',
  /** main -> janela de notas: abra esta nota. */
  notesOpen: 'notes:open',
  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  tasksComplete: 'tasks:complete',
  tasksReopen: 'tasks:reopen',
  tasksScheduleRemove: 'tasks:schedule-remove',
  tasksUndoRemove: 'tasks:undo-remove',
  tasksSetDue: 'tasks:set-due',
  tasksUpdate: 'tasks:update',
  tasksReorder: 'tasks:reorder',
  /** main -> renderer: lembrete de prazo (soon = faltam alguns minutos; due = chegou a hora). */
  tasksReminder: 'tasks:reminder',
  /** renderer -> main (invoke): aviso sobre o armazenamento (ou null) e sua dispensa. */
  tasksNotice: 'tasks:notice',
  tasksDismissNotice: 'tasks:dismiss-notice',
  /** main -> renderer: alguma tarefa mudou (recarregue a lista). */
  tasksChanged: 'tasks:changed',
  /** main -> renderer: uma tarefa acabou de ser concluída. */
  tasksCompleted: 'tasks:completed',
  /** main -> renderer: uma tarefa acabou de ser criada. */
  tasksCreated: 'tasks:created',
  /** renderer -> main: o layout da nova apresentação já foi desenhado. */
  presentationApplied: 'presentation:applied',
  /** renderer -> main (invoke): libera a forma cheia da ilha antes da animação de abrir. */
  islandOpen: 'island:open',
  /** renderer -> main: a animação de recolher terminou; a forma pode voltar a compacta. */
  islandClosed: 'island:closed',
  /** main -> renderer: pedido de alternar a ilha vindo do menu (alternativa ao clique). */
  islandToggle: 'island:toggle',
  /** Agenda (iCal): estado, endereço (só entra, nunca sai), remoção e atualização. */
  calendarGet: 'calendar:get',
  calendarSetUrl: 'calendar:set-url',
  calendarClear: 'calendar:clear',
  calendarRefresh: 'calendar:refresh',
  calendarChanged: 'calendar:changed',
  /** renderer -> main: há (ou não) um balão de fala visível; a forma da janela acompanha. */
  bubbleVisible: 'bubble:visible',
  /** main -> renderer: o atalho global pediu a ilha (abre direto nas tarefas). */
  islandSummon: 'island:summon',
  /** Preferências e navegação do painel. */
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  panelOpenSettings: 'panel:open-settings',
  panelInitialView: 'panel:initial-view',
  panelNavigate: 'panel:navigate',
  /** renderer -> main: a ilha começou a se esconder (a linha-dica aparece neste instante). */
  islandHiding: 'island:hiding',
  /** renderer -> main: a ilha terminou de subir e se esconder; o Nimboo pode surgir no canto. */
  islandHidden: 'island:hidden',
  /** main -> renderer: o Nimboo deve sair de cena (a ilha vai voltar). */
  leave: 'presence:leave',
  /** renderer -> main: a animação de saída terminou. */
  leaveDone: 'presence:leave-done',
  /** renderer -> main (invoke): modo foco (temporizador). O relógio vive no main. */
  focusGet: 'focus:get',
  focusStart: 'focus:start',
  focusPause: 'focus:pause',
  focusResume: 'focus:resume',
  focusCancel: 'focus:cancel',
  focusStats: 'focus:stats',
  /** main -> renderer: o estado do temporizador mudou. */
  focusChanged: 'focus:changed',
  /** main -> renderer: uma sessão terminou sozinha. */
  focusFinished: 'focus:finished',
} as const;

/** Posição do cursor em pixels (DIP) relativa ao canto superior esquerdo da janela. */
export interface CursorPoint {
  x: number;
  y: number;
}

/** API mínima exposta ao renderer em `window.mochi`. */
export interface MochiApi {
  /** Inicia um arraste da janela (posição do cursor é lida no main). */
  startDrag(): void;
  /** Atualiza a posição da janela de acordo com o cursor. */
  moveDrag(): void;
  endDrag(): void;
  /** Abre o menu de contexto nativo do mascote. */
  showMenu(): void;
  /** Recebe a posição do cursor em toda a tela. Retorna a função de cancelamento. */
  onCursor(listener: (point: CursorPoint) => void): () => void;
  /** Apresentação atual; a entrada pendente é entregue uma única vez. */
  getPresentation(): Promise<PresentationState>;
  /** Avisa quando a apresentação muda. Retorna a função de cancelamento. */
  onPresentationChange(listener: (state: PresentationState) => void): () => void;
  /** Confirma que o layout da apresentação atual já foi desenhado. */
  presentationApplied(): void;
  /** Libera a forma cheia da ilha; resolve quando já pode animar a abertura. */
  islandOpen(): Promise<void>;
  /** Ajusta a forma da ilha aberta à tela atual; resolve quando já pode animar. */
  islandExtent(extent: IslandExtent): Promise<void>;
  /** Informa que a ilha terminou de recolher visualmente. */
  islandClosed(): void;
  /** Tarefas (armazenamento local; só operações específicas, nunca SQL). */
  tasks: TasksApi;
  notes: NotesApi;
  assistant: AssistantApi;
  /** Vinculo com o Nimboo: conquistas, dias juntos e afeto. */
  bond: {
    get(): Promise<BondSnapshot>;
    /** Foco e tarefas concluídas nos últimos 7 dias. */
    week(): Promise<WeekStats | null>;
    /** Eventos da interface (carinho, assistente, voz, evento->tarefa, subtarefa). */
    event(type: 'pet' | 'assistant' | 'voice' | 'event_task' | 'subtask'): void;
    saveAffection(value: number): void;
    /** Abre a janela de conquistas. */
    open(): void;
    onChange(listener: (snapshot: BondSnapshot) => void): () => void;
  };
  /** Exportar/importar tarefas e notas (arquivo JSON, pelo diálogo do Windows). */
  data: {
    export(): Promise<{ ok: boolean; message: string }>;
    import(): Promise<{ ok: boolean; message: string }>;
  };
  /** Modo foco (temporizador; o relógio vive no processo principal). */
  focus: FocusApi;
  /** Preferências: lê, altera (validadas no main) e acompanha mudanças feitas em qualquer janela. */
  settings: {
    get(): Promise<SettingsSnapshot>;
    update(patch: Partial<Omit<Settings, 'version'>>): Promise<SettingsSnapshot>;
    onChange(listener: (snapshot: SettingsSnapshot) => void): () => void;
  };
  /** Agenda por endereço iCal (somente leitura). O endereço nunca volta para a interface. */
  calendar: {
    get(): Promise<CalendarState>;
    setUrl(url: string): Promise<CalendarResult<CalendarState>>;
    clear(): Promise<CalendarState>;
    refresh(): Promise<CalendarState>;
    onChange(listener: (state: CalendarState) => void): () => void;
  };
  /** Informa que o balão de fala está visível (ou não). */
  bubbleVisible(visible: boolean): void;
  /** O atalho global pediu a ilha. Retorna a função de cancelamento. */
  onSummon(listener: () => void): () => void;
  /** Abre o painel já nas configurações (engrenagem da ilha). */
  openSettings(): void;
  /** Painel: tela inicial pedida por quem o abriu e mudanças de tela posteriores. */
  panel: {
    initialView(): Promise<PanelView>;
    onNavigate(listener: (view: PanelView) => void): () => void;
  };
  /** Informa que a ilha começou a se esconder. */
  islandHiding(): void;
  /** Informa que a ilha terminou de se esconder (o Nimboo surge no canto). */
  islandHidden(): void;
  /** O main pede que o Nimboo saia de cena. Retorna a função de cancelamento. */
  onLeave(listener: () => void): () => void;
  /** Confirma que a saída de cena terminou. */
  leaveDone(): void;
  /** Recebe o pedido do menu para alternar a ilha. Retorna a função de cancelamento. */
  onIslandToggle(listener: () => void): () => void;
}
