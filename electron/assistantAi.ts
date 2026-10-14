/**
 * Conhecimento do assistente SEM chave e SEM tokens:
 *  - Wikipédia (pt): busca + resumo da página, pela API pública (só https, só `pt.wikipedia.org`);
 *  - IA local (Ollama): conversa com um modelo rodando na própria máquina (só 127.0.0.1:11434).
 * Tudo roda no processo principal. Nada é enviado a menos que a pessoa ligue a opção correspondente.
 */

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
}>;

export type AiResult =
  | { ok: true; source: 'wikipedia' | 'ollama'; text: string; title?: string; url?: string }
  | { ok: false; code: 'offline' | 'not_found' | 'ollama_missing' | 'model_missing' | 'error'; message: string };

export const WIKI_HOST = 'pt.wikipedia.org';
export const OLLAMA_BASE = 'http://127.0.0.1:11434';
const TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_MS = 180_000;
export const MAX_ANSWER_CHARS = 900;

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Tira a "casca" da pergunta ("quem foi", "o que é", "qual a capital da") para a busca. */
export function cleanQuestion(question: string): string {
  let q = question.trim().replace(/[?!.]+$/g, '').trim();
  const patterns = [
    /^(?:me\s+)?(?:diga|fale|conte|explique|explica|fala|diz)(?:\s+(?:para mim|pra mim))?\s+(?:o que\s+(?:e|é)|quem\s+(?:e|é|foi)|sobre|a respeito de)?\s*/i,
    /^(?:quem|o que|oque|que)\s+(?:e|é|foi|eram|era|são|sao)\s+/i,
    /^(?:qual|quais)\s+(?:e|é|foi|são|sao)\s+(?:a|o|as|os)\s+/i,
    /^(?:onde|quando|como)\s+(?:fica|ficam|foi|nasceu|morreu|surgiu|funciona)\s+/i,
    /^(?:pesquis(?:e|ar)|busqu?e|procur(?:e|ar))\s+(?:sobre|por|a respeito de)?\s*/i,
  ];
  for (const re of patterns) {
    const next = q.replace(re, '').trim();
    if (next && next !== q) {
      q = next;
      break;
    }
  }
  return q.replace(/^(?:a|o|as|os|um|uma)\s+/i, '').slice(0, 120).trim();
}

/** Corta em frase inteira, sem passar do limite. */
export function clipAnswer(text: string, max = MAX_ANSWER_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`).trim();
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export async function askWikipedia(question: string, fetchImpl: FetchLike): Promise<AiResult> {
  const query = cleanQuestion(question);
  if (query.length < 2) return { ok: false, code: 'not_found', message: 'Não entendi o que procurar.' };
  try {
    const search = await withTimeout(TIMEOUT_MS, (signal) =>
      fetchImpl(`https://${WIKI_HOST}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=1`, {
        headers: { Accept: 'application/json', 'User-Agent': 'MochiDesktopBuddy/0.4 (assistente local)' },
        signal,
      }),
    );
    if (!search.ok) return { ok: false, code: 'error', message: 'A Wikipédia não respondeu agora.' };
    const found = await search.json();
    const page = isRecord(found) && Array.isArray(found.pages) && isRecord(found.pages[0]) ? found.pages[0] : null;
    const key = page && typeof page.key === 'string' ? page.key : null;
    if (!key) return { ok: false, code: 'not_found', message: `Não achei nada sobre “${query}” na Wikipédia.` };

    const summary = await withTimeout(TIMEOUT_MS, (signal) =>
      fetchImpl(`https://${WIKI_HOST}/api/rest_v1/page/summary/${encodeURIComponent(key)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'MochiDesktopBuddy/0.4 (assistente local)' },
        signal,
      }),
    );
    if (!summary.ok) return { ok: false, code: 'not_found', message: `Não achei um resumo sobre “${query}”.` };
    const data = await summary.json();
    if (!isRecord(data) || typeof data.extract !== 'string' || data.extract.trim() === '') {
      return { ok: false, code: 'not_found', message: `Não achei um resumo sobre “${query}”.` };
    }
    const title = typeof data.title === 'string' ? data.title : key.replace(/_/g, ' ');
    let url: string | undefined;
    const pageUrl = isRecord(data.content_urls) && isRecord(data.content_urls.desktop) ? data.content_urls.desktop.page : null;
    if (typeof pageUrl === 'string') {
      try {
        const u = new URL(pageUrl);
        if (u.protocol === 'https:' && u.hostname === WIKI_HOST) url = u.toString();
      } catch {
        /* sem link */
      }
    }
    return { ok: true, source: 'wikipedia', title, text: clipAnswer(data.extract), url };
  } catch {
    return { ok: false, code: 'offline', message: 'Não consegui acessar a internet agora.' };
  }
}

export interface OllamaStatus {
  running: boolean;
  models: string[];
}

export async function ollamaStatus(fetchImpl: FetchLike): Promise<OllamaStatus> {
  try {
    const res = await withTimeout(2500, (signal) => fetchImpl(`${OLLAMA_BASE}/api/tags`, { signal }));
    if (!res.ok) return { running: false, models: [] };
    const data = await res.json();
    const list = isRecord(data) && Array.isArray(data.models) ? data.models : [];
    const models = list.flatMap((m) => (isRecord(m) && typeof m.name === 'string' ? [m.name] : []));
    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
}

export const SYSTEM_PROMPT =
  'Você é o Nimboo, um assistente de mesa simpático e objetivo. Responda sempre em português do Brasil, ' +
  'em no máximo 4 frases curtas. Se não souber ou não tiver certeza, diga isso com honestidade. ' +
  'Você não tem acesso à internet nem ao computador da pessoa.';

export async function askOllama(question: string, history: ChatTurn[], model: string, fetchImpl: FetchLike): Promise<AiResult> {
  const status = await ollamaStatus(fetchImpl);
  if (!status.running) {
    return { ok: false, code: 'ollama_missing', message: 'A IA local (Ollama) não está rodando neste computador.' };
  }
  const base = model.split(':')[0];
  if (!status.models.some((m) => m === model || m.split(':')[0] === base && !model.includes(':'))) {
    return { ok: false, code: 'model_missing', message: `O modelo “${model}” ainda não foi baixado no Ollama.` };
  }
  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-6).map((t) => ({ role: t.role, content: t.content.slice(0, 1500) })),
      { role: 'user', content: question.slice(0, 2000) },
    ];
    const res = await withTimeout(CHAT_TIMEOUT_MS, (signal) =>
      fetchImpl(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.4, num_predict: 400 } }),
        signal,
      }),
    );
    if (!res.ok) return { ok: false, code: 'error', message: 'A IA local não conseguiu responder.' };
    const data = await res.json();
    const content = isRecord(data) && isRecord(data.message) && typeof data.message.content === 'string' ? data.message.content : '';
    if (content.trim() === '') return { ok: false, code: 'error', message: 'A IA local não devolveu resposta.' };
    return { ok: true, source: 'ollama', text: clipAnswer(content, 1500) };
  } catch {
    return { ok: false, code: 'error', message: 'A IA local demorou demais ou foi interrompida.' };
  }
}

export interface PullProgress {
  status: string;
  /** 0..1 quando o Ollama informa total e completado. */
  fraction: number | null;
}

/** Baixa um modelo pelo Ollama (que é quem faz o download); acompanha o progresso linha a linha. */
export async function pullOllamaModel(
  model: string,
  fetchImpl: FetchLike,
  onProgress: (p: PullProgress) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const status = await ollamaStatus(fetchImpl);
  if (!status.running) return { ok: false, message: 'O Ollama não está rodando neste computador.' };
  try {
    const res = await fetchImpl(`${OLLAMA_BASE}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) return { ok: false, message: 'O Ollama recusou o download do modelo.' };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let failed: string | null = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line) as Record<string, unknown>;
          if (typeof j.error === 'string') failed = j.error;
          const total = typeof j.total === 'number' ? j.total : 0;
          const completed = typeof j.completed === 'number' ? j.completed : 0;
          onProgress({
            status: typeof j.status === 'string' ? j.status : '',
            fraction: total > 0 ? Math.min(1, completed / total) : null,
          });
        } catch {
          /* linha parcial */
        }
      }
    }
    return failed ? { ok: false, message: 'Não consegui baixar esse modelo (confira o nome).' } : { ok: true };
  } catch {
    return { ok: false, message: 'O download foi interrompido.' };
  }
}
