/** Avisos do sistema que o app agenda (funcionam com o app fechado no Android). */
export interface Notifier {
  /** Agenda "sessão concluída" para o instante `at` (ms desde a época), no lugar de qualquer aviso anterior. */
  scheduleFocusEnd(at: number, kind: 'focus' | 'break'): Promise<void>;
  cancelFocusEnd(): Promise<void>;
  /** Pede a permissão de notificações (Android 13+). Devolve se foi concedida. */
  requestPermission(): Promise<boolean>;
}

/** Sem avisos (testes e navegador sem permissão). */
export const silentNotifier: Notifier = {
  scheduleFocusEnd: async () => {},
  cancelFocusEnd: async () => {},
  requestPermission: async () => false,
};

/** Texto do aviso de fim de sessão. */
export function focusEndText(kind: 'focus' | 'break'): { title: string; body: string } {
  return kind === 'focus'
    ? { title: 'Foco concluído', body: 'Boa! Hora de uma pausa.' }
    : { title: 'Pausa concluída', body: 'Pronto para focar de novo?' };
}
