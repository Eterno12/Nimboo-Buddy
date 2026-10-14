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

/** Uma mensagem guardada da conversa (só texto; botões e "desfazer" não são guardados). */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  text: string;
  source?: { label: string; url?: string };
  /** ISO 8601. */
  at: string;
}

/** Quantas mensagens a conversa guarda (as mais antigas saem sozinhas). */
export const HISTORY_LIMIT = 200;
export const HISTORY_TEXT_MAX = 2000;

export interface GeminiStatus {
  /** Há uma chave guardada (o valor nunca chega à interface). */
  hasKey: boolean;
  /** O Windows consegue cifrar a chave neste computador. */
  encryptionAvailable: boolean;
}

export type GeminiChatOutcome =
  | { ok: true; text: string }
  | { ok: false; code: string; message: string; partial?: string };

export interface GeminiChatRequest {
  /** Conversa até agora, terminando na mensagem nova da pessoa. */
  turns: { role: 'user' | 'model'; text: string }[];
  /** Resumo do dia (títulos), só se a pessoa permitiu; `null` caso contrário. */
  context: string | null;
}

export interface GeminiApi {
  status(): Promise<GeminiStatus>;
  setKey(key: string): Promise<{ ok: boolean; message: string }>;
  clearKey(): Promise<void>;
  /** Faz uma chamada mínima para conferir chave e modelo. */
  test(): Promise<{ ok: boolean; message: string }>;
  /** Abre a página oficial onde a pessoa cria a chave. */
  openKeyPage(): void;
  chat(requestId: number, request: GeminiChatRequest): Promise<GeminiChatOutcome>;
  cancelChat(requestId: number): void;
  onChatDelta(listener: (requestId: number, delta: string) => void): () => void;
}

export interface AssistantApi {
  /** Abre (ou traz à frente) a janela do assistente. */
  open(): void;
  /** Gemini (Google): conversa com identidade, usando a chave da própria pessoa. */
  gemini: GeminiApi;
  /** Histórico da conversa neste computador. */
  history: {
    list(): Promise<HistoryEntry[]>;
    add(entries: Omit<HistoryEntry, 'at'>[]): void;
    clear(): Promise<void>;
  };
  /** O atalho global pediu para ouvir (janela já aberta). */
  onStartListen(listener: () => void): () => void;
  /** A janela acabou de abrir por causa do atalho? Lê e limpa o pedido. */
  takePendingListen(): Promise<boolean>;
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
