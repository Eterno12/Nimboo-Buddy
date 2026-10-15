import type { WidgetSnapshot } from '../widget.ts';

/** Ponte entre o app e o widget da tela inicial (código nativo). */
export interface WidgetBridge {
  /** Grava o resumo que o widget lê. */
  write(snapshot: WidgetSnapshot): Promise<void>;
  /** Pede ao Android para redesenhar o widget agora. */
  refresh(): Promise<void>;
  /** O que o widget deixou para o app fazer (JSON) ou `null`. */
  readInbox(): Promise<string | null>;
  clearInbox(): Promise<void>;
}

/** Sem widget (navegador e testes). */
export const noWidget: WidgetBridge = {
  write: async () => {},
  refresh: async () => {},
  readInbox: async () => null,
  clearInbox: async () => {},
};
