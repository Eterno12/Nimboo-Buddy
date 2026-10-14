/**
 * Cliente mínimo da API do Google Gemini (REST, streaming por SSE). Sem dependências: a rede é injetável
 * (testes) e a chave vai só no cabeçalho `x-goog-api-key` (nunca na URL, para não aparecer em logs).
 */
import { GEMINI_MODEL_RE } from '../shared/settings.ts';

export interface GeminiTurn {
  role: 'user' | 'model';
  text: string;
}

export interface GeminiFetchResponse {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type GeminiFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<GeminiFetchResponse>;

export type GeminiErrorCode =
  | 'no_key'
  | 'invalid_key'
  | 'quota'
  | 'model'
  | 'blocked'
  | 'offline'
  | 'timeout'
  | 'canceled'
  | 'error';

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; code: GeminiErrorCode; message: string; partial?: string };

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_OUTPUT_TOKENS = 800;
const MAX_TURNS = 14;
const MAX_TURN_CHARS = 2000;
const DEFAULT_TIMEOUT_MS = 45_000;

const MESSAGES: Record<GeminiErrorCode, string> = {
  no_key: 'Falta a chave do Gemini. Cole a chave em Configurações > Assistente.',
  invalid_key: 'O Google não aceitou a chave. Confira se copiou inteira ou crie outra em aistudio.google.com/apikey.',
  quota: 'O limite grátis do Gemini acabou por agora. Tente de novo daqui a alguns minutos.',
  model: 'O Google não encontrou esse modelo. Troque o modelo em Configurações > Assistente.',
  blocked: 'O Gemini não quis responder a essa mensagem. Tente dizer de outro jeito.',
  offline: 'Não consegui falar com o Gemini. Confira sua internet.',
  timeout: 'O Gemini demorou demais para responder. Tente de novo.',
  canceled: 'Cancelado.',
  error: 'O Gemini teve um problema agora. Tente de novo em instantes.',
};

const fail = (code: GeminiErrorCode, partial?: string): GeminiResult => ({
  ok: false,
  code,
  message: MESSAGES[code],
  ...(partial ? { partial } : {}),
});

export interface GeminiRequestInput {
  system: string;
  turns: GeminiTurn[];
}

/** Corpo da requisição: a instrução do sistema + as últimas mensagens (o limite protege cota e privacidade). */
export function buildGeminiBody({ system, turns }: GeminiRequestInput): object {
  const recent = turns
    .filter((t) => (t.role === 'user' || t.role === 'model') && typeof t.text === 'string' && t.text.trim() !== '')
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, parts: [{ text: t.text.slice(0, MAX_TURN_CHARS) }] }));
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: recent,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.9 },
  };
}

/** Texto (e bloqueio) de um objeto de resposta do Gemini. */
export function readCandidate(json: unknown): { text: string; blocked: boolean } {
  const obj = (typeof json === 'object' && json !== null ? json : {}) as {
    candidates?: { content?: { parts?: { text?: unknown }[] }; finishReason?: unknown }[];
    promptFeedback?: { blockReason?: unknown };
  };
  const parts = obj.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
  const blocked = !!obj.promptFeedback?.blockReason || (text === '' && obj.candidates?.[0]?.finishReason === 'SAFETY');
  return { text, blocked };
}

function mapHttpError(status: number, body: string): GeminiResult {
  const lower = body.toLowerCase();
  if (status === 429 || lower.includes('quota') || lower.includes('resource_exhausted')) return fail('quota');
  if (status === 401 || status === 403 || lower.includes('api key not valid') || lower.includes('api_key_invalid')) {
    return fail('invalid_key');
  }
  if (status === 400 && lower.includes('api key')) return fail('invalid_key');
  if (status === 404) return fail('model');
  return fail('error');
}

export interface StreamOptions extends GeminiRequestInput {
  key: string;
  model: string;
  fetchImpl: GeminiFetch;
  onDelta?(text: string): void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Conversa com streaming. Devolve o texto completo; os pedaços chegam por `onDelta`. */
export async function streamGemini(opts: StreamOptions): Promise<GeminiResult> {
  if (!opts.key) return fail('no_key');
  if (!GEMINI_MODEL_RE.test(opts.model)) return fail('model');
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  let full = '';
  try {
    const url = `${GEMINI_BASE}/models/${opts.model}:streamGenerateContent?alt=sse`;
    const res = await opts.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.key },
      body: JSON.stringify(buildGeminiBody(opts)),
      signal: controller.signal,
    });
    if (!res.ok) return mapHttpError(res.status, await res.text().catch(() => ''));
    if (!res.body) return fail('error');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let blocked = false;
    const handleEvent = (block: string) => {
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const c = readCandidate(JSON.parse(payload));
          if (c.blocked) blocked = true;
          if (c.text) {
            full += c.text;
            opts.onDelta?.(c.text);
          }
        } catch {
          /* pedaço malformado: ignora */
        }
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const sep = /\r?\n\r?\n/.exec(buffer.slice(idx));
        handleEvent(buffer.slice(0, idx));
        buffer = buffer.slice(idx + (sep ? sep[0].length : 2));
      }
    }
    if (buffer.trim()) handleEvent(buffer);
    if (full.trim() === '') return blocked ? fail('blocked') : fail('error');
    return { ok: true, text: full };
  } catch (error) {
    if (timedOut) return fail('timeout', full);
    if (opts.signal?.aborted) return fail('canceled', full);
    if (error instanceof Error && error.name === 'AbortError') return fail('canceled', full);
    return fail('offline', full);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
