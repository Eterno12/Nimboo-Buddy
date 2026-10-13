/** Preferências do usuário persistidas em disco (settings.json). */

export type PresentationMode = 'floating' | 'island';

export interface Settings {
  version: 2;
  /** Modo preferido: `island` (padrão; ilha que se esconde) ou `floating` (mascote fixo, solto). */
  mode: PresentationMode;
  /** Última posição do mascote flutuante (DIP). */
  floating: { x: number; y: number } | null;
  /** Monitor preferido da ilha. */
  displayId: number | null;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  version: 2,
  mode: 'island',
  floating: null,
  displayId: null,
});

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Aceita qualquer entrada; campos inválidos voltam ao padrão e campos extras são descartados.
 * Arquivos da versão 1 (em que o padrão era flutuante e o modo só era gravado como efeito
 * colateral de mover o mascote) migram para o padrão atual, mantendo a posição salva.
 */
export function parseSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, floating: null };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 && r.version !== 2) return out;

  if (r.version === 2 && (r.mode === 'floating' || r.mode === 'island')) out.mode = r.mode;

  const f = r.floating;
  if (typeof f === 'object' && f !== null) {
    const { x, y } = f as Record<string, unknown>;
    if (isFiniteNumber(x) && isFiniteNumber(y)) out.floating = { x: Math.round(x), y: Math.round(y) };
  }

  if (isFiniteNumber(r.displayId)) out.displayId = r.displayId;
  return out;
}
