/** Preferências do usuário persistidas em disco (settings.json). */

import { WELLNESS_INTERVALS } from './wellness.ts';

/** Nome do personagem original (e padrão do nome que a pessoa dá). O id interno continua `mochi`. */
export const DEFAULT_MASCOT_NAME = 'Nimboo';

export type PresentationMode = 'floating' | 'island';

/** Modo com que o app SEMPRE abre, independentemente do que ficou salvo. */
export const STARTUP_MODE: PresentationMode = 'island';

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

/** Atalhos globais para falar com o assistente (sempre diferentes dos do painel). `null` desliga. */
export const ASSISTANT_SHORTCUT_PRESETS = ['Control+Alt+V', 'Control+Alt+A', 'Control+Shift+V'] as const;

/** Paletas do Nimboo. Cada uma é definida em `mascot.css` (`data-palette`). */
export const MOCHI_COLORS = ['mint', 'peach', 'sky', 'lilac', 'lemon', 'rose'] as const;
export type MochiColor = (typeof MOCHI_COLORS)[number];

/** Personagens selecionáveis. mochi é o original e o padrão; um valor desconhecido volta a ele. */
export const CHARACTERS = ['mochi', 'pineapple', 'square', 'mushroom', 'cactus', 'cloud', 'planet', 'ghost'] as const;
export type CharacterId = (typeof CHARACTERS)[number];
export const DEFAULT_CHARACTER: CharacterId = 'mochi';
/** Nomes exibidos (painel, bandeja e leitores de tela): uma única fonte para o main e o renderer. */
export const CHARACTER_LABELS: Record<CharacterId, string> = {
  mochi: 'Nimboo',
  pineapple: 'Abacaxi',
  square: 'Quadrado',
  mushroom: 'Cogumelo',
  cactus: 'Cacto',
  cloud: 'Nuvem',
  planet: 'Planeta',
  ghost: 'Fantasma',
};

/** Tema do painel e das configurações: segue o Windows (automático) ou fixo. A ilha é sempre escura. */
export const THEMES = ['auto', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

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
  /** Tamanho do Nimboo solto (modo flutuante e Nimboo no canto). */
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
  /** Balões de fala do Nimboo. */
  bubbles: boolean;
  /** Esconder a ilha/Nimboo enquanto há um app em tela cheia (jogo, vídeo, apresentação). */
  doNotDisturb: boolean;
  /** Personagem na área de trabalho. */
  character: CharacterId;
  /** Cor do Nimboo (só o personagem original tem paletas; os demais têm as próprias cores). */
  color: MochiColor;
  /** Tema do painel/configurações. */
  theme: ThemePreference;
  /** Modo foco: duração (min) do último foco iniciado e das pausas. */
  focusMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  /** Ciclo Pomodoro (pausa longa a cada 4 focos). */
  pomodoroCycle: boolean;
  /** Com o ciclo ligado, inicia a próxima etapa sozinho depois de uns segundos. */
  pomodoroAuto: boolean;
  /** Lembretes de prazo das tarefas (balão, som e notificação se o Nimboo estiver oculto). */
  remindersEnabled: boolean;
  /** Aviso antecipado em minutos (0 = só na hora marcada). */
  reminderLeadMin: number;
  /** O assistente pode pesquisar na Wikipédia quando a pergunta não é um comando (usa a internet). */
  assistantWeb: boolean;
  /** O assistente pode usar uma IA local (Ollama, em 127.0.0.1) para conversar. */
  assistantLocalAi: boolean;
  /** Modelo do Ollama (ex.: "qwen2.5:3b"). */
  assistantModel: string;
  /** Resumo do dia no primeiro uso da manhã (cartão nas tarefas + uma fala do Nimboo). */
  routineMorning: boolean;
  /** Fechamento do dia (o que foi concluído, foco e pendências) a partir da hora escolhida. */
  routineEvening: boolean;
  /** Hora local do fechamento (17 a 21). */
  routineEveningHour: number;
  /** Dia (AAAA-MM-DD) em que o resumo/fechamento já foi visto ou dispensado; `null` = nunca. */
  routineLastMorning: string | null;
  routineLastEvening: string | null;
  /** Nome que a pessoa deu ao personagem (aparece no assistente e nas conquistas). */
  mascotName: string;
  /** Bem-estar: lembretes gentis (tudo desligado por padrão). Intervalos em minutos. */
  wellnessWater: boolean;
  wellnessWaterMin: number;
  wellnessPosture: boolean;
  wellnessPostureMin: number;
  wellnessEyes: boolean;
  wellnessEyesMin: number;
  /** Ao terminar uma sessão de foco, sugere levantar e alongar. */
  wellnessStretch: boolean;
  /** Guarda a conversa do assistente neste computador (visível e apagável). */
  assistantHistory: boolean;
  /** Atalho global que abre o assistente já ouvindo; `null` = desligado. */
  assistantShortcut: string | null;
  /** Conversar com o Gemini (Google) usando a chave da pessoa. Desligado por padrão; envia o texto à internet. */
  assistantGemini: boolean;
  /** Modelo do Gemini (nome da API). */
  geminiModel: string;
  /** Ajustes livres da pessoa para o jeito do personagem (até 400 caracteres). */
  assistantPersona: string;
  /** Deixar o Gemini ver os títulos das tarefas pendentes e da agenda de hoje (desligado por padrão). */
  assistantContext: boolean;
}

/** Nome de modelo do Gemini aceito (letras minúsculas, números, ponto e hífen). */
export const GEMINI_MODEL_RE = /^[a-z0-9][a-z0-9.-]{1,60}$/;
export const GEMINI_MODEL_SUGGESTIONS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'] as const;
export const PERSONA_NOTES_LIMIT = 400;

/** Antecedências oferecidas para o lembrete de prazo (minutos). */
export const REMINDER_LEADS_MIN = [0, 5, 10, 15, 30] as const;

/** Horas oferecidas para o fechamento do dia. */
export const ROUTINE_EVENING_HOURS = [17, 18, 19, 20, 21] as const;
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  version: 3,
  mode: 'island',
  floating: null,
  displayId: null,
  islandScale: 1,
  mochiScale: 1,
  hideDelaySec: 3,
  launchAtLogin: false,
  // Ctrl+Alt+M (de "Nimboo"): Ctrl+Alt+Espaço costuma estar em uso por outros apps (ex.: Claude).
  shortcut: 'Control+Alt+M',
  soundEnabled: true,
  soundVolume: 0.4,
  bubbles: true,
  doNotDisturb: true,
  character: 'mochi',
  color: 'mint',
  theme: 'auto',
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  pomodoroCycle: false,
  pomodoroAuto: false,
  remindersEnabled: true,
  reminderLeadMin: 10,
  assistantWeb: false,
  assistantLocalAi: false,
  assistantModel: 'qwen2.5:3b',
  routineMorning: true,
  routineEvening: true,
  routineEveningHour: 18,
  routineLastMorning: null,
  routineLastEvening: null,
  mascotName: DEFAULT_MASCOT_NAME,
  wellnessWater: false,
  wellnessWaterMin: 60,
  wellnessPosture: false,
  wellnessPostureMin: 45,
  wellnessEyes: false,
  wellnessEyesMin: 20,
  wellnessStretch: false,
  assistantHistory: true,
  assistantShortcut: null,
  assistantGemini: false,
  geminiModel: 'gemini-3.5-flash-lite',
  assistantPersona: '',
  assistantContext: false,
});

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Nome de modelo aceito (formato do Ollama: nome[:tag], com / para bibliotecas de usuários). */
export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}(?:\/[a-z0-9][a-z0-9._-]{0,40})?(?::[a-z0-9][a-z0-9._-]{0,30})?$/i;

/** Número inteiro dentro de [min, max]; qualquer outra coisa volta ao padrão. */
function intInRange(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

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
    if (typeof r.character === 'string' && (CHARACTERS as readonly string[]).includes(r.character)) {
      out.character = r.character as CharacterId;
    }
    if (typeof r.theme === 'string' && (THEMES as readonly string[]).includes(r.theme)) {
      out.theme = r.theme as ThemePreference;
    }
    out.focusMinutes = intInRange(r.focusMinutes, 1, 180, DEFAULT_SETTINGS.focusMinutes);
    out.breakMinutes = intInRange(r.breakMinutes, 1, 60, DEFAULT_SETTINGS.breakMinutes);
    out.longBreakMinutes = intInRange(r.longBreakMinutes, 1, 60, DEFAULT_SETTINGS.longBreakMinutes);
    if (typeof r.pomodoroCycle === 'boolean') out.pomodoroCycle = r.pomodoroCycle;
    if (typeof r.pomodoroAuto === 'boolean') out.pomodoroAuto = r.pomodoroAuto;
    if (typeof r.remindersEnabled === 'boolean') out.remindersEnabled = r.remindersEnabled;
    if (isFiniteNumber(r.reminderLeadMin)) out.reminderLeadMin = nearestOf(REMINDER_LEADS_MIN, r.reminderLeadMin);
    if (typeof r.assistantWeb === 'boolean') out.assistantWeb = r.assistantWeb;
    if (typeof r.assistantLocalAi === 'boolean') out.assistantLocalAi = r.assistantLocalAi;
    if (typeof r.assistantModel === 'string' && MODEL_NAME_RE.test(r.assistantModel)) out.assistantModel = r.assistantModel;
    if (typeof r.routineMorning === 'boolean') out.routineMorning = r.routineMorning;
    if (typeof r.routineEvening === 'boolean') out.routineEvening = r.routineEvening;
    if (isFiniteNumber(r.routineEveningHour)) out.routineEveningHour = nearestOf(ROUTINE_EVENING_HOURS, r.routineEveningHour);
    if (typeof r.routineLastMorning === 'string' && DAY_KEY_RE.test(r.routineLastMorning)) out.routineLastMorning = r.routineLastMorning;
    if (typeof r.routineLastEvening === 'string' && DAY_KEY_RE.test(r.routineLastEvening)) out.routineLastEvening = r.routineLastEvening;
    if (typeof r.assistantGemini === 'boolean') out.assistantGemini = r.assistantGemini;
    if (typeof r.assistantContext === 'boolean') out.assistantContext = r.assistantContext;
    if (typeof r.geminiModel === 'string' && GEMINI_MODEL_RE.test(r.geminiModel.trim())) out.geminiModel = r.geminiModel.trim();
    if (typeof r.assistantPersona === 'string') {
      // eslint-disable-next-line no-control-regex
      const persona = r.assistantPersona.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
      out.assistantPersona = [...persona].slice(0, PERSONA_NOTES_LIMIT).join('');
    }
    if (typeof r.assistantHistory === 'boolean') out.assistantHistory = r.assistantHistory;
    if (r.assistantShortcut === null) out.assistantShortcut = null;
    else if (typeof r.assistantShortcut === 'string' && (ASSISTANT_SHORTCUT_PRESETS as readonly string[]).includes(r.assistantShortcut)) {
      out.assistantShortcut = r.assistantShortcut;
    }
    if (typeof r.wellnessWater === 'boolean') out.wellnessWater = r.wellnessWater;
    if (typeof r.wellnessPosture === 'boolean') out.wellnessPosture = r.wellnessPosture;
    if (typeof r.wellnessEyes === 'boolean') out.wellnessEyes = r.wellnessEyes;
    if (typeof r.wellnessStretch === 'boolean') out.wellnessStretch = r.wellnessStretch;
    if (isFiniteNumber(r.wellnessWaterMin)) out.wellnessWaterMin = nearestOf(WELLNESS_INTERVALS.water, r.wellnessWaterMin);
    if (isFiniteNumber(r.wellnessPostureMin)) out.wellnessPostureMin = nearestOf(WELLNESS_INTERVALS.posture, r.wellnessPostureMin);
    if (isFiniteNumber(r.wellnessEyesMin)) out.wellnessEyesMin = nearestOf(WELLNESS_INTERVALS.eyes, r.wellnessEyesMin);
    if (typeof r.mascotName === 'string') {
      const name = r.mascotName.replace(/\s+/g, ' ').trim();
      // eslint-disable-next-line no-control-regex
      if (name.length > 0 && [...name].length <= 20 && !/[\u0000-\u001f\u007f<>]/.test(name)) {
        // Instalações antigas guardaram o nome padrão anterior ("Mochi"): vira o nome atual do app.
        out.mascotName = name === 'Mochi' ? DEFAULT_MASCOT_NAME : name;
      }
    }
  }
  return out;
}
