import { useSyncExternalStore } from 'react';

/**
 * Rascunho do campo "Nova tarefa". Vive em memória, fora do componente: assim
 * sobrevive a recolher/reabrir a ilha e a trocar de tela (o componente é
 * desmontado) sem ser gravado no banco. Cada janela tem o seu.
 */
export interface DraftState {
  text: string;
  /** O campo está com o foco do teclado. */
  focused: boolean;
}

type Listener = () => void;

let state: DraftState = { text: '', focused: false };
const listeners = new Set<Listener>();

function set(next: DraftState): void {
  if (next.text === state.text && next.focused === state.focused) return;
  state = next; // novo objeto: `useSyncExternalStore` compara por identidade
  listeners.forEach((l) => l());
}

export const draftStore = {
  get: (): DraftState => state,
  setText: (text: string) => set({ ...state, text }),
  setFocused: (focused: boolean) => set({ ...state, focused }),
  clear: () => set({ ...state, text: '' }),
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Reinicia tudo (usado nos testes). */
  reset: () => set({ text: '', focused: false }),
};

/**
 * Enquanto há foco no campo ou texto não enviado, a ilha não deve recolher
 * sozinha por inatividade.
 */
export function shouldHoldOpen(s: DraftState): boolean {
  return s.focused || s.text.trim().length > 0;
}

export function useDraft(): DraftState & { hold: boolean } {
  const s = useSyncExternalStore(draftStore.subscribe, draftStore.get);
  return { ...s, hold: shouldHoldOpen(s) };
}
