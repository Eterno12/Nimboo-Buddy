import fs from 'node:fs';
import { app, BrowserWindow, ipcMain, net, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import type { Settings } from '../shared/settings';
import { MODEL_NAME_RE } from '../shared/settings';
import type { AssistantAiAnswer, AssistantAiStatus, AssistantChatTurn, SpeechOutcome } from '../shared/assistantApi';
import { createSpeechListener } from './speech';
import {
  askOllama,
  askWikipedia,
  ollamaStatus,
  pullOllamaModel,
  type AiResult,
  type FetchLike,
} from './assistantAi';
import { createAssistantWindow } from './windows';
import type { AssistantHistory } from './assistant/historyStore';
import type { GeminiKeyStore } from './geminiKey';
import type { GeminiChatOutcome, GeminiStatus } from '../shared/assistantApi';
import { buildSystemPrompt } from '../shared/persona';
import {
  listGeminiModels,
  pickGeminiModel,
  streamGemini,
  type GeminiFetch,
  type GeminiFetchResponse,
  type GeminiResult,
  type GeminiTurn,
} from './gemini';

export interface AssistantService {
  /** `listen`: abre já ouvindo o microfone (atalho global). */
  openWindow(options?: { listen?: boolean }): void;
  close(): void;
}

interface AssistantServiceOptions {
  isAppUrl(url: string): boolean;
  settings(): Settings;
  isDark(): boolean;
  /** Histórico da conversa (ausente se o banco não abriu). */
  getHistory?(): AssistantHistory | null;
  /** Guarda da chave do Gemini (cifrada pelo Windows). */
  keyStore?: GeminiKeyStore;
}

const GEMINI_KEY_PAGE = 'https://aistudio.google.com/apikey';

/**
 * Só para testes e2e (app NÃO empacotado): MOCHI_E2E_GEMINI_FIXTURE aponta um JSON { chunks: string[],
 * status?: number }; a "resposta" do Gemini é montada localmente. Nada vai para a rede.
 */
function fixtureGemini(file: string): GeminiFetch {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { chunks?: unknown; status?: unknown; error?: unknown };
  return async (url) => {
    if (url.includes('/models?')) {
      const body = JSON.stringify({
        models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }],
      });
      return { ok: true, status: 200, body: null, text: async () => body };
    }
    const status = typeof data.status === 'number' ? data.status : 200;
    if (status !== 200) {
      const body = JSON.stringify({ error: { message: typeof data.error === 'string' ? data.error : 'erro' } });
      return { ok: false, status, body: null, text: async () => body };
    }
    const chunks = Array.isArray(data.chunks) ? data.chunks.filter((c): c is string => typeof c === 'string') : [];
    const sse = chunks
      .map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
      .join('');
    const res = new Response(sse);
    return { ok: true, status: 200, body: res.body, text: async () => sse };
  };
}

const MAX_QUESTION = 1000;

/** `net.fetch` do Electron (respeita proxy do sistema) com a forma mínima que o módulo de IA usa. */
const electronFetch: FetchLike = (url, init) =>
  net.fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

/**
 * Só para testes e2e (app NÃO empacotado): MOCHI_E2E_AI_FIXTURE aponta um JSON com respostas prontas da
 * Wikipédia ({ search, summary }); o Ollama aparece como \"não está rodando\". Nada vai para a rede.
 */
function fixtureFetch(file: string): FetchLike {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { search?: unknown; summary?: unknown };
  const reply = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  return async (url) => {
    if (url.includes('/search/page')) return reply(data.search ?? { pages: [] });
    if (url.includes('/page/summary/')) return reply(data.summary ?? {});
    throw new Error('sem rede (fixture)');
  };
}

/**
 * Assistente: janela de conversa, voz (Windows) e conhecimento opcional (Wikipédia / IA local). A rede é
 * usada só aqui no processo principal e só quando a pessoa liga a opção correspondente.
 */
export function startAssistantService({ isAppUrl, settings, isDark, getHistory, keyStore }: AssistantServiceOptions): AssistantService {
  const geminiFixture = !app.isPackaged ? process.env.MOCHI_E2E_GEMINI_FIXTURE : undefined;
  const geminiFetch: GeminiFetch = geminiFixture
    ? fixtureGemini(geminiFixture)
    : (url, init) => net.fetch(url, init as RequestInit) as unknown as Promise<GeminiFetchResponse>;
  const chats = new Map<number, AbortController>();
  const fixtureFile = !app.isPackaged ? process.env.MOCHI_E2E_AI_FIXTURE : undefined;
  const fetcher: FetchLike = fixtureFile ? fixtureFetch(fixtureFile) : electronFetch;
  let win: BrowserWindow | null = null;
  const listener = createSpeechListener();
  let pulling = false;

  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || w.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };

  /** O atalho abriu a janela pedindo para ouvir; a interface lê isto ao montar. */
  let pendingListen = false;

  const openWindow = (options?: { listen?: boolean }) => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (options?.listen) win.webContents.send(IPC.assistantStartListen);
      return;
    }
    pendingListen = options?.listen === true;
    win = createAssistantWindow(isDark());
    win.on('closed', () => {
      listener.cancel();
      for (const c of chats.values()) c.abort();
      pendingListen = false;
      win = null;
    });
  };

  ipcMain.on(IPC.assistantOpen, (event) => {
    if (trusted(event)) openWindow();
  });

  // ---- Gemini (Google): chave guardada cifrada, conversa com identidade e streaming ----
  ipcMain.handle(IPC.geminiStatus, (event): GeminiStatus => {
    if (!trusted(event) || !keyStore) return { hasKey: false, encryptionAvailable: false };
    return { hasKey: keyStore.has(), encryptionAvailable: keyStore.encryptionAvailable() };
  });
  ipcMain.handle(IPC.geminiSetKey, (event, key: unknown): { ok: boolean; message: string } => {
    if (!trusted(event) || !keyStore) return { ok: false, message: 'Não foi possível guardar a chave.' };
    const r = keyStore.set(key);
    return r.ok ? { ok: true, message: 'Chave guardada com segurança neste computador.' } : { ok: false, message: r.message };
  });
  ipcMain.handle(IPC.geminiClearKey, (event) => {
    if (trusted(event)) keyStore?.clear();
  });
  ipcMain.on(IPC.geminiOpenKeyPage, (event) => {
    if (trusted(event)) void shell.openExternal(GEMINI_KEY_PAGE);
  });

  const runGemini = async (
    turns: GeminiTurn[],
    context: string | null,
    onDelta: (d: string) => void,
    signal?: AbortSignal,
    system?: string,
  ): Promise<GeminiResult & { model?: string }> => {
    const key = keyStore?.get() ?? null;
    if (!key) return { ok: false, code: 'no_key', message: 'Falta a chave do Gemini. Cole a chave em Configurações > Assistente.' };
    const s = settings();
    const prompt =
      system ??
      buildSystemPrompt({
        character: s.character,
        name: s.mascotName,
        userNotes: s.assistantPersona,
        now: new Date(),
        context: s.assistantContext ? context : null,
      });
    const attempt = (model: string) =>
      streamGemini({ key, model, system: prompt, turns, onDelta, fetchImpl: geminiFetch, signal });
    let model = s.geminiModel;
    let result = await attempt(model);
    // Modelo que a chave não enxerga: descobre um que funcione e tenta uma vez de novo.
    if (!result.ok && result.code === 'model') {
      const listed = await listGeminiModels(key, geminiFetch);
      const better = listed.ok ? pickGeminiModel(listed.models, model) : null;
      if (better && better !== model) {
        model = better;
        result = await attempt(model);
      }
    }
    return result.ok ? { ...result, model } : result;
  };

  ipcMain.handle(IPC.geminiTest, async (event): Promise<{ ok: boolean; message: string; model?: string }> => {
    if (!trusted(event)) return { ok: false, message: 'Remetente não autorizado.' };
    const key = keyStore?.get() ?? null;
    if (!key) return { ok: false, message: 'Falta a chave do Gemini. Cole a chave e clique em “Guardar chave”.' };
    // 1) a chave enxerga algum modelo? (isso já separa "chave ruim" de "modelo ruim")
    const listed = await listGeminiModels(key, geminiFetch);
    if (!listed.ok) return { ok: false, message: listed.result.ok ? 'Erro desconhecido.' : listed.result.message };
    const chosen = pickGeminiModel(listed.models, settings().geminiModel);
    if (!chosen) return { ok: false, message: 'A chave funciona, mas não encontrei nenhum modelo de texto liberado para ela.' };
    // 2) uma pergunta mínima com o modelo escolhido
    const r = await streamGemini({
      key,
      model: chosen,
      system: 'Responda em no máximo duas palavras.',
      turns: [{ role: 'user', text: 'Responda apenas: ok' }],
      fetchImpl: geminiFetch,
    });
    if (!r.ok) return { ok: false, message: r.message };
    const switched = chosen !== settings().geminiModel;
    return {
      ok: true,
      model: chosen,
      message: switched ? `Conexão funcionando! Usei o modelo ${chosen}.` : 'Conexão funcionando!',
    };
  });

  ipcMain.handle(IPC.geminiChat, async (event, requestId: unknown, request: unknown): Promise<GeminiChatOutcome> => {
    const denied = (message: string): GeminiChatOutcome => ({ ok: false, code: 'error', message });
    if (!trusted(event)) return denied('Remetente não autorizado.');
    if (!settings().assistantGemini) {
      return { ok: false, code: 'disabled', message: 'O Gemini está desligado. Ative em Configurações > Assistente.' };
    }
    if (typeof requestId !== 'number' || typeof request !== 'object' || request === null) return denied('Pedido inválido.');
    const req = request as { turns?: unknown; context?: unknown };
    const turns: GeminiTurn[] = Array.isArray(req.turns)
      ? req.turns.flatMap((t: unknown) => {
          if (typeof t !== 'object' || t === null) return [];
          const o = t as { role?: unknown; text?: unknown };
          if ((o.role !== 'user' && o.role !== 'model') || typeof o.text !== 'string') return [];
          return [{ role: o.role, text: o.text }];
        })
      : [];
    if (turns.length === 0 || turns[turns.length - 1].role !== 'user') return denied('Pedido inválido.');
    const context = typeof req.context === 'string' ? req.context.slice(0, 1500) : null;
    const controller = new AbortController();
    chats.get(requestId)?.abort();
    chats.set(requestId, controller);
    const sender = event.sender;
    try {
      const r = await runGemini(
        turns,
        context,
        (delta) => {
          if (!sender.isDestroyed()) sender.send(IPC.geminiChatDelta, { requestId, delta });
        },
        controller.signal,
      );
      return r.ok
        ? { ok: true, text: r.text, model: r.model }
        : { ok: false, code: r.code, message: r.message, partial: r.partial };
    } finally {
      chats.delete(requestId);
    }
  });
  ipcMain.on(IPC.geminiChatCancel, (event, requestId: unknown) => {
    if (!trusted(event) || typeof requestId !== 'number') return;
    chats.get(requestId)?.abort();
  });

  ipcMain.handle(IPC.assistantTakePendingListen, (event): boolean => {
    if (!trusted(event)) return false;
    const was = pendingListen;
    pendingListen = false;
    return was;
  });

  ipcMain.handle(IPC.assistantHistoryList, (event) => {
    if (!trusted(event)) return [];
    try {
      return getHistory?.()?.list() ?? [];
    } catch (error) {
      console.error('Falha ao ler o histórico do assistente:', error);
      return [];
    }
  });
  ipcMain.on(IPC.assistantHistoryAdd, (event, entries: unknown) => {
    if (!trusted(event) || !settings().assistantHistory) return;
    try {
      getHistory?.()?.add(entries);
    } catch (error) {
      console.error('Falha ao guardar o histórico do assistente:', error);
    }
  });
  ipcMain.handle(IPC.assistantHistoryClear, (event) => {
    if (!trusted(event)) return;
    try {
      getHistory?.()?.clear();
    } catch (error) {
      console.error('Falha ao apagar o histórico do assistente:', error);
    }
  });

  ipcMain.handle(IPC.assistantListen, async (event): Promise<SpeechOutcome> => {
    if (!trusted(event)) return { ok: false, code: 'unavailable', message: 'Remetente não autorizado.' };
    const r = await listener.listen();
    return r.ok ? { ok: true, text: r.text } : { ok: false, code: r.error.code, message: r.error.message };
  });
  ipcMain.on(IPC.assistantListenCancel, (event) => {
    if (trusted(event)) listener.cancel();
  });
  ipcMain.on(IPC.assistantOpenSpeechSettings, (event) => {
    if (trusted(event)) void shell.openExternal('ms-settings:privacy-speech');
  });

  ipcMain.handle(IPC.assistantAiStatus, async (event): Promise<AssistantAiStatus> => {
    const s = settings();
    const base: AssistantAiStatus = {
      webEnabled: s.assistantWeb,
      localEnabled: s.assistantLocalAi,
      model: s.assistantModel,
      ollamaRunning: false,
      models: [],
    };
    if (!trusted(event)) return base;
    const status = await ollamaStatus(fetcher);
    return { ...base, ollamaRunning: status.running, models: status.models };
  });

  ipcMain.handle(IPC.assistantAsk, async (event, question: unknown, history: unknown): Promise<AssistantAiAnswer> => {
    if (!trusted(event)) return { ok: false, code: 'error', message: 'Remetente não autorizado.' };
    const text = typeof question === 'string' ? question.trim().slice(0, MAX_QUESTION) : '';
    if (text === '') return { ok: false, code: 'not_found', message: 'Pergunte alguma coisa.' };
    const turns: AssistantChatTurn[] = Array.isArray(history)
      ? history
          .filter(
            (t): t is AssistantChatTurn =>
              typeof t === 'object' && t !== null && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string',
          )
          .slice(-8)
      : [];
    const s = settings();
    if (!s.assistantLocalAi && !s.assistantWeb) {
      return {
        ok: false,
        code: 'disabled',
        message:
          'Para responder perguntas eu preciso de uma fonte: ative a pesquisa na Wikipédia ou a IA local (Ollama) nas configurações do assistente.',
      };
    }
    let last: AiResult | null = null;
    if (s.assistantLocalAi) {
      last = await askOllama(text, turns, s.assistantModel, fetcher);
      if (last.ok) return last;
      // Sem IA local disponível: cai na Wikipédia se estiver ligada; senão devolve o motivo.
      if (!s.assistantWeb) return last;
    }
    const wiki = await askWikipedia(text, fetcher);
    if (wiki.ok) return wiki;
    return last && last.code !== 'not_found' && wiki.code === 'not_found' ? { ...wiki, message: `${last.message} ${wiki.message}` } : wiki;
  });

  ipcMain.handle(IPC.assistantPullModel, async (event, model: unknown): Promise<{ ok: boolean; message: string }> => {
    if (!trusted(event)) return { ok: false, message: 'Remetente não autorizado.' };
    const name = typeof model === 'string' ? model : settings().assistantModel;
    if (!MODEL_NAME_RE.test(name)) return { ok: false, message: 'Nome de modelo inválido.' };
    if (pulling) return { ok: false, message: 'Já estou baixando um modelo.' };
    pulling = true;
    try {
      const r = await pullOllamaModel(name, fetcher, (p) => {
        if (win && !win.isDestroyed()) win.webContents.send(IPC.assistantPullProgress, p);
      });
      return r.ok ? { ok: true, message: 'Modelo pronto!' } : r;
    } finally {
      pulling = false;
    }
  });

  return {
    openWindow,
    close() {
      listener.cancel();
      ipcMain.removeAllListeners(IPC.assistantOpen);
      ipcMain.removeAllListeners(IPC.assistantHistoryAdd);
      ipcMain.removeAllListeners(IPC.geminiOpenKeyPage);
      ipcMain.removeAllListeners(IPC.geminiChatCancel);
      for (const c of chats.values()) c.abort();
      for (const channel of [IPC.geminiStatus, IPC.geminiSetKey, IPC.geminiClearKey, IPC.geminiTest, IPC.geminiChat]) {
        ipcMain.removeHandler(channel);
      }
      ipcMain.removeAllListeners(IPC.assistantListenCancel);
      ipcMain.removeAllListeners(IPC.assistantOpenSpeechSettings);
      for (const channel of [
        IPC.assistantListen,
        IPC.assistantAiStatus,
        IPC.assistantAsk,
        IPC.assistantPullModel,
        IPC.assistantTakePendingListen,
        IPC.assistantHistoryList,
        IPC.assistantHistoryClear,
      ]) {
        ipcMain.removeHandler(channel);
      }
      if (win && !win.isDestroyed()) win.destroy();
    },
  };
}
