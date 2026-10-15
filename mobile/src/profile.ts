import { CHARACTERS, MOCHI_COLORS, type CharacterId, type MochiColor } from '../../shared/settings.ts';

/** Como o Nimboo aparece neste aparelho. Guardado nas preferências locais (sincroniza na F5). */
export interface Profile {
  character: CharacterId;
  color: MochiColor;
  name: string;
}

export const DEFAULT_PROFILE: Profile = { character: 'mochi', color: 'mint', name: 'Nimboo' };

/** Lê o perfil guardado; valores inválidos ou ausentes voltam ao padrão (nunca lança). */
export function parseProfile(text: string | null): Profile {
  if (!text) return { ...DEFAULT_PROFILE };
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const character = (CHARACTERS as readonly string[]).includes(String(raw.character)) ? (raw.character as CharacterId) : DEFAULT_PROFILE.character;
    const color = (MOCHI_COLORS as readonly string[]).includes(String(raw.color)) ? (raw.color as MochiColor) : DEFAULT_PROFILE.color;
    const name = typeof raw.name === 'string' && raw.name.trim().length > 0 && raw.name.length <= 24 ? raw.name.trim() : DEFAULT_PROFILE.name;
    return { character, color, name };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export const serializeProfile = (p: Profile): string => JSON.stringify(p);
