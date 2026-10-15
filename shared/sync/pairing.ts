/**
 * Conexão do celular por QR code. O PC (já logado) pede ao servidor um token de uso único e o mostra
 * como QR; o celular lê, troca o token por uma sessão da MESMA conta e começa a sincronizar.
 * O QR nunca leva a sessão do PC: só um token de uso único, com prazo curto e preso a este projeto.
 */
export const PAIRING_TTL_MS = 2 * 60_000;

const PREFIX = 'nimboo://pair?';
const HASH_RE = /^[A-Za-z0-9_.-]{16,200}$/;
/** Tolerância para relógios levemente desencontrados entre PC e celular. */
const SKEW_MS = 30_000;

/** O "host" do projeto (ex.: `abcd.supabase.co`), usado para o QR só valer no projeto certo. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export function encodePairing(input: { url: string; tokenHash: string; now: number }): string {
  const params = new URLSearchParams({
    v: '1',
    h: input.tokenHash,
    x: String(Math.floor((input.now + PAIRING_TTL_MS) / 1000)),
    p: hostOf(input.url),
  });
  return PREFIX + params.toString();
}

export type PairingResult = { ok: true; tokenHash: string } | { ok: false; message: string };

export function parsePairing(text: string, ctx: { url: string; now: number }): PairingResult {
  const invalid: PairingResult = { ok: false, message: 'Esse QR não é do Nimboo. Abra "Conectar celular" no PC.' };
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return invalid;
  const params = new URLSearchParams(text.slice(PREFIX.length));
  const hash = params.get('h') ?? '';
  const expires = Number(params.get('x'));
  if (params.get('v') !== '1' || !HASH_RE.test(hash) || !Number.isFinite(expires)) return invalid;
  if (params.get('p') !== hostOf(ctx.url)) return { ok: false, message: 'Esse QR é de outra conta ou projeto.' };
  if (expires * 1000 + SKEW_MS < ctx.now) return { ok: false, message: 'O QR expirou. Gere um novo no PC.' };
  return { ok: true, tokenHash: hash };
}
