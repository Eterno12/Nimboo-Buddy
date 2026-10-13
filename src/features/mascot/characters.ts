import { CHARACTER_LABELS, type CharacterId } from '../../../shared/settings.ts';
import { NEUTRAL_PROFILE, type SoundProfile } from '../audio/sounds.ts';

/**
 * Registro dos personagens. Todos usam o MESMO controlador de estados, as MESMAS animações-base, o
 * MESMO motor de áudio e a MESMA interação; aqui ficam só as diferenças:
 *  - identidade (nome, descrição, personalidade);
 *  - ritmos do controlador (`traits`);
 *  - identidade sonora (`sound`, aplicada a qualquer som);
 *  - ajuste do rosto no corpo (`face`), porque o rosto é compartilhado.
 * O desenho em si fica em `characterArt.tsx`.
 */

/** Ajustes de personalidade do controlador (multiplicadores; 1 = como o original). */
export interface CharacterTraits {
  /** Intervalo entre comportamentos espontâneos (menor = mais agitado). */
  ambientPace: number;
  /** Quanto tempo parado até bocejar e dormir (menor = mais sonolento). */
  sleepAfter: number;
  /** Intervalo entre piscadas (menor = pisca mais). */
  blinkPace: number;
  /** Quanto a mais ele "olha em volta" nos comportamentos espontâneos (0..0,3). */
  curiosity: number;
}

/** Posição/tamanho do rosto compartilhado sobre o corpo (translação em unidades do viewBox 200). */
export interface FaceFit {
  dx: number;
  dy: number;
  scale: number;
}

export interface CharacterInfo {
  id: CharacterId;
  /** Nome exibido (pt-BR). */
  label: string;
  /** Descrição curta da personalidade. */
  tagline: string;
  traits: CharacterTraits;
  face: FaceFit;
  sound: SoundProfile;
  /** Frases extras (soltas e de boas-vindas) que carregam a personalidade. */
  lines: { idle: readonly string[]; hello: readonly string[] };
}

export const NEUTRAL_TRAITS: CharacterTraits = { ambientPace: 1, sleepAfter: 1, blinkPace: 1, curiosity: 0 };

const T = (t: Partial<CharacterTraits>): CharacterTraits => ({ ...NEUTRAL_TRAITS, ...t });

const S = (s: Partial<SoundProfile>): SoundProfile => ({ ...NEUTRAL_PROFILE, ...s });

export const CHARACTER_REGISTRY: Record<CharacterId, CharacterInfo> = {
  mochi: {
    id: 'mochi',
    label: CHARACTER_LABELS.mochi,
    tagline: 'Fofo e brincalhão',
    traits: T({}),
    face: { dx: 0, dy: 0, scale: 1 },
    sound: S({}),
    lines: { idle: [], hello: [] },
  },
  pineapple: {
    id: 'pineapple',
    label: CHARACTER_LABELS.pineapple,
    tagline: 'Energético e muito expressivo',
    traits: T({ ambientPace: 0.7, sleepAfter: 1.6, blinkPace: 0.85 }),
    face: { dx: 0, dy: 2, scale: 0.96 },
    sound: S({ pitch: 1.2, durationScale: 0.8, glide: 0.07, voicePitch: 1.2, voiceGlide: 0.05 }),
    lines: {
      idle: ['Bora fazer algo legal!', 'Tô cheio de energia!', 'Que tal uma tarefa rapidinha?'],
      hello: ['Oba, você chegou!', 'Vamos nessa!'],
    },
  },
  square: {
    id: 'square',
    label: CHARACTER_LABELS.square,
    tagline: 'Tranquilo e confiável',
    traits: T({ ambientPace: 1.15, sleepAfter: 1.1 }),
    face: { dx: 0, dy: 0, scale: 1 },
    sound: S({ pitch: 0.85, durationScale: 1.15, gainScale: 0.85, wave: 'sine', voicePitch: 0.85 }),
    lines: {
      idle: ['Tudo em ordem por aqui.', 'Um passo de cada vez.', 'Pode contar comigo.'],
      hello: ['Oi. Tudo certo?', 'Estou aqui.'],
    },
  },
  mushroom: {
    id: 'mushroom',
    label: CHARACTER_LABELS.mushroom,
    tagline: 'Tímido, curioso e sonolento',
    traits: T({ ambientPace: 1.25, sleepAfter: 0.7, blinkPace: 1.1, curiosity: 0.15 }),
    face: { dx: 0, dy: 22, scale: 0.84 },
    sound: S({ pitch: 1.05, durationScale: 1.1, gainScale: 0.85, vibrato: 12, voicePitch: 1.05 }),
    lines: {
      idle: ['Será que posso olhar?', 'Hm... que sono...', 'Fico aqui quietinho.'],
      hello: ['Oi... tudo bem?', 'Ah, oi!'],
    },
  },
  cactus: {
    id: 'cactus',
    label: CHARACTER_LABELS.cactus,
    tagline: 'Determinado e brincalhão',
    traits: T({ ambientPace: 0.9, sleepAfter: 1.2 }),
    face: { dx: 0, dy: 2, scale: 0.9 },
    sound: S({ pitch: 1, durationScale: 0.75, wave: 'triangle', click: true, voicePitch: 1.05 }),
    lines: {
      idle: ['Não desisto fácil!', 'Quer apostar que termino hoje?', 'Pode vir, não pinica.'],
      hello: ['Tô de pé!', 'Bora?'],
    },
  },
  cloud: {
    id: 'cloud',
    label: CHARACTER_LABELS.cloud,
    tagline: 'Calma, sonhadora e sonolenta',
    traits: T({ ambientPace: 1.35, sleepAfter: 0.75 }),
    face: { dx: 0, dy: 8, scale: 0.95 },
    sound: S({ pitch: 1.12, durationScale: 1.5, gainScale: 0.8, layer: { ratio: 2, gain: 0.35 }, voicePitch: 1.1 }),
    lines: {
      idle: ['Flutuando por aqui...', 'Que céu bonito hoje.', 'Respira devagar.'],
      hello: ['Oi, com calma...', 'Bom te ver.'],
    },
  },
  planet: {
    id: 'planet',
    label: CHARACTER_LABELS.planet,
    tagline: 'Curioso e contemplativo',
    traits: T({ ambientPace: 1.2, sleepAfter: 1.1, curiosity: 0.25 }),
    face: { dx: 0, dy: 0, scale: 0.92 },
    sound: S({ pitch: 1.25, layer: { ratio: 1.5, gain: 0.4 }, glide: 0.04, voicePitch: 1.2, voiceGlide: 0.03 }),
    lines: {
      idle: ['Quantas estrelas há por aí?', 'Descobri uma coisa curiosa.', 'O universo é enorme.'],
      hello: ['Olá, viajante.', 'Que bom te encontrar.'],
    },
  },
  ghost: {
    id: 'ghost',
    label: CHARACTER_LABELS.ghost,
    tagline: 'Travesso e misterioso',
    traits: T({ ambientPace: 0.85, sleepAfter: 1, curiosity: 0.2 }),
    face: { dx: 0, dy: -2, scale: 1 },
    sound: S({ pitch: 0.92, durationScale: 1.25, gainScale: 0.85, vibrato: 25, glide: 0.1, voicePitch: 0.92, voiceGlide: 0.08 }),
    lines: {
      idle: ['Buuu! Brincadeira.', 'Aparecendo de novo...', 'Shhh... sou silencioso.'],
      hello: ['Buu! Te assustei?', 'Cheguei sem fazer barulho.'],
    },
  },
};

/** Personagem válido (valor desconhecido ou antigo vira o original). */
export function characterInfo(id: string | null | undefined): CharacterInfo {
  // Object.hasOwn: chaves herdadas ('__proto__', 'constructor') não são personagens.
  return typeof id === 'string' && Object.hasOwn(CHARACTER_REGISTRY, id)
    ? CHARACTER_REGISTRY[id as CharacterId]
    : CHARACTER_REGISTRY.mochi;
}
