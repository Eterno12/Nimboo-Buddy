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
export function startAssistantService({ isAppUrl, settings, isDark, getHistory }: AssistantServiceOptions): AssistantService {
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
      pendingListen = false;
      win = null;
    });
  };

  ipcMain.on(IPC.assistantOpen, (event) => {
    if (trusted(event)) openWindow();
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
