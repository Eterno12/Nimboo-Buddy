import { CHARACTERS, MOCHI_COLORS, type CharacterId, type MochiColor } from '../settings.ts';
import { skinById } from '../skins.ts';

/** O que "o Nimboo parece" e que viaja entre os aparelhos (PC e celular mostram o mesmo personagem). */
export interface ProfileData {
  character: CharacterId;
  color: MochiColor;
  name: string;
  /** Acessório em uso (`<personagem>.<nome>`) ou `null`. */
  skin: string | null;
}

export const PROFILE_NAME_MAX = 24;

/** Lê e valida; `null` quando não é um perfil válido (nunca lança). Acessório de outro personagem vira `null`. */
export function parseProfileData(text: string | null | undefined): ProfileData | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!(CHARACTERS as readonly string[]).includes(String(raw.character))) return null;
    if (!(MOCHI_COLORS as readonly string[]).includes(String(raw.color))) return null;
    if (typeof raw.name !== 'string' || raw.name.trim() === '' || raw.name.length > PROFILE_NAME_MAX) return null;
    const character = raw.character as CharacterId;
    const wanted = skinById(typeof raw.skin === 'string' ? raw.skin : null);
    return {
      character,
      color: raw.color as MochiColor,
      name: raw.name.trim(),
      skin: wanted && wanted.character === character ? wanted.id : null,
    };
  } catch {
    return null;
  }
}

export const serializeProfileData = (p: ProfileData): string => JSON.stringify(p);

export const profileEquals = (a: ProfileData, b: ProfileData): boolean =>
  a.character === b.character && a.color === b.color && a.name === b.name && a.skin === b.skin;
