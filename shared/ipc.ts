import type { IslandExtent, PresentationState } from './presentation';
import type { TasksApi } from './tasks';

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
  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  tasksComplete: 'tasks:complete',
  tasksReopen: 'tasks:reopen',
  tasksScheduleRemove: 'tasks:schedule-remove',
  tasksUndoRemove: 'tasks:undo-remove',
  /** main -> renderer: alguma tarefa mudou (recarregue a lista). */
  tasksChanged: 'tasks:changed',
  /** main -> renderer: uma tarefa acabou de ser concluída. */
  tasksCompleted: 'tasks:completed',
  /** renderer -> main: o layout da nova apresentação já foi desenhado. */
  presentationApplied: 'presentation:applied',
  /** renderer -> main (invoke): libera a forma cheia da ilha antes da animação de abrir. */
  islandOpen: 'island:open',
  /** renderer -> main: a animação de recolher terminou; a forma pode voltar a compacta. */
  islandClosed: 'island:closed',
  /** main -> renderer: pedido de alternar a ilha vindo do menu (alternativa ao clique). */
  islandToggle: 'island:toggle',
  /** renderer -> main: a ilha terminou de subir e se esconder; o Mochi pode surgir no canto. */
  islandHidden: 'island:hidden',
  /** main -> renderer: o Mochi deve sair de cena (a ilha vai voltar). */
  leave: 'presence:leave',
  /** renderer -> main: a animação de saída terminou. */
  leaveDone: 'presence:leave-done',
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
  /** Informa que a ilha terminou de se esconder (o Mochi surge no canto). */
  islandHidden(): void;
  /** O main pede que o Mochi saia de cena. Retorna a função de cancelamento. */
  onLeave(listener: () => void): () => void;
  /** Confirma que a saída de cena terminou. */
  leaveDone(): void;
  /** Recebe o pedido do menu para alternar a ilha. Retorna a função de cancelamento. */
  onIslandToggle(listener: () => void): () => void;
}
