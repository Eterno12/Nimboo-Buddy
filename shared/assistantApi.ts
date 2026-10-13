/** Contratos do assistente entre o processo principal e as janelas (sem Electron nem React). */

export interface AssistantChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type SpeechOutcome =
  | { ok: true; text: string }
  | { ok: false; code: 'privacy' | 'microphone' | 'no_speech' | 'busy' | 'unavailable' | 'timeout' | 'canceled'; message: string };

export type AssistantAiAnswer =
  | { ok: true; source: 'wikipedia' | 'ollama'; text: string; title?: string; url?: string }
  | { ok: false; code: 'disabled' | 'offline' | 'not_found' | 'ollama_missing' | 'model_missing' | 'error'; message: string };

export interface AssistantAiStatus {
  /** A pessoa permitiu pesquisar na Wikipédia. */
  webEnabled: boolean;
  /** A pessoa permitiu usar a IA local (Ollama). */
  localEnabled: boolean;
  model: string;
  ollamaRunning: boolean;
  models: string[];
}

export interface PullProgressEvent {
  status: string;
  fraction: number | null;
}

export interface AssistantApi {
  /** Abre (ou traz à frente) a janela do assistente. */
  open(): void;
  /** Ouve uma frase pelo microfone (Windows) e devolve o texto. */
  listen(): Promise<SpeechOutcome>;
  cancelListen(): void;
  /** Abre as configurações de privacidade de fala do Windows. */
  openSpeechSettings(): void;
  /** Pergunta livre (Wikipédia e/ou IA local, conforme as preferências). */
  ask(question: string, history: AssistantChatTurn[]): Promise<AssistantAiAnswer>;
  status(): Promise<AssistantAiStatus>;
  /** Pede ao Ollama que baixe o modelo escolhido. */
  pullModel(model?: string): Promise<{ ok: boolean; message: string }>;
  onPullProgress(listener: (p: PullProgressEvent) => void): () => void;
}
