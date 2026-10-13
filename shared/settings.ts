/** Preferências do usuário persistidas em disco (settings.json). */

export type PresentationMode = 'floating' | 'island';

/** Tamanhos permitidos (fator sobre o tamanho base). Passos fixos: o layout fica previsível. */
export const ISLAND_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.4] as const;
export const MOCHI_SCALES = [0.7, 0.85, 1, 1.2, 1.4, 1.6] as const;

/** Segundos até a ilha recolhida se esconder; `0` = nunca se esconde sozinha. */
export const HIDE_DELAYS_SEC = [3, 6, 10, 0] as const;

/** Atalhos globais oferecidos (aceleradores do Electron). `null` desliga o atalho. */
export const SHORTCUT_PRESETS = [
  'Control+Alt+M',
  'Control+Alt+Space',
  'Control+Shift+Space',
  'Control+Alt+J',
] as const;

/** Paletas do Mochi. Cada uma é definida em `mascot.css` (`data-palette`). */
export const MOCHI_COLORS = ['mint', 'peach', 'sky', 'lilac', 'lemon', 'rose'] as const;
export type MochiColor = (typeof MOCHI_COLORS)[number];

export interface Settings {
  version: 3;
  /** Modo preferido: `island` (padrão; ilha que se esconde) ou `floating` (mascote fixo, solto). */
  mode: PresentationMode;
  /** Última posição do mascote flutuante (DIP). */
  floating: { x: number; y: number } | null;
  /** Monitor preferido da ilha. */
  displayId: number | null;
  /** Tamanho da ilha (modo ilha). */
  islandScale: number;
  /** Tamanho do Mochi solto (modo flutuante e Mochi no canto). */
  mochiScale: number;
  /** Segundos até a ilha recolhida se esconder (`0` = nunca). */
  hideDelaySec: number;
  /** Iniciar com o Windows (só vale no app instalado). */
  launchAtLogin: boolean;
  /** Atalho global para chamar a ilha (`null` = desligado). */
  shortcut: string | null;
  /** Sons discretos (tec, sininhos, voz do balão). */
  soundEnabled: boolean;
  /** Volume dos sons (0 a 1). */
  soundVolume: number;
  /** Balões de fala do Mochi. */
  bubbles: boolean;
  /** Esconder a ilha/Mochi enquanto há um app em tela cheia (jogo, vídeo, apresentação). */
  doNotDisturb: boolean;
  /** Cor do Mochi. */
  color: MochiColor;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  version: 3,
  mode: 'island',
  floating: null,
  displayId: null,
  islandScale: 1,
  mochiScale: 1,
  hideDelaySec: 3,
  launchAtLogin: false,
  // Ctrl+Alt+M (de "Mochi"): Ctrl+Alt+Espaço costuma estar em uso por outros apps (ex.: Claude).
  shortcut: 'Control+Alt+M',
  soundEnabled: true,
  soundVolume: 0.4,
  bubbles: true,
  doNotDisturb: true,
  color: 'mint',
});

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** O valor permitido mais próximo de `v` (qualquer número vira um dos passos oferecidos). */
export function nearestOf<T extends number>(allowed: readonly T[], v: number): T {
  let best = allowed[0];
  for (const a of allowed) if (Math.abs(a - v) < Math.abs(best - v)) best = a;
  return best;
}

/**
 * Aceita qualquer entrada; campos inválidos voltam ao padrão e campos extras são descartados.
 * Arquivos da versão 1 (em que o padrão era flutuante e o modo só era gravado como efeito
 * colateral de mover o mascote) migram para o padrão atual, mantendo a posição salva.
 * Versões 1 e 2 ganham os campos da v3 com os valores padrão.
 */
export function parseSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, floating: null };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 && r.version !== 2 && r.version !== 3) return out;

  if (r.version !== 1 && (r.mode === 'floating' || r.mode === 'island')) out.mode = r.mode;

  const f = r.floating;
  if (typeof f === 'object' && f !== null) {
    const { x, y } = f as Record<string, unknown>;
    if (isFiniteNumber(x) && isFiniteNumber(y)) out.floating = { x: Math.round(x), y: Math.round(y) };
  }

  if (isFiniteNumber(r.displayId)) out.displayId = r.displayId;

  if (r.version === 3) {
    if (isFiniteNumber(r.islandScale)) out.islandScale = nearestOf(ISLAND_SCALES, r.islandScale);
    if (isFiniteNumber(r.mochiScale)) out.mochiScale = nearestOf(MOCHI_SCALES, r.mochiScale);
    if (isFiniteNumber(r.hideDelaySec)) out.hideDelaySec = nearestOf(HIDE_DELAYS_SEC, r.hideDelaySec);
    if (typeof r.launchAtLogin === 'boolean') out.launchAtLogin = r.launchAtLogin;
    if (r.shortcut === null) out.shortcut = null;
    else if (typeof r.shortcut === 'string' && (SHORTCUT_PRESETS as readonly string[]).includes(r.shortcut)) {
      out.shortcut = r.shortcut;
    }
    if (typeof r.soundEnabled === 'boolean') out.soundEnabled = r.soundEnabled;
    if (isFiniteNumber(r.soundVolume)) out.soundVolume = Math.round(Math.min(1, Math.max(0, r.soundVolume)) * 20) / 20;
    if (typeof r.bubbles === 'boolean') out.bubbles = r.bubbles;
    if (typeof r.doNotDisturb === 'boolean') out.doNotDisturb = r.doNotDisturb;
    if (typeof r.color === 'string' && (MOCHI_COLORS as readonly string[]).includes(r.color)) {
      out.color = r.color as MochiColor;
    }
  }
  return out;
}
