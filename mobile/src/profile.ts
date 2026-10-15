import { CHARACTERS, MOCHI_COLORS, type CharacterId, type MochiColor } from '../../shared/settings.ts';
import { skinById } from '../../shared/skins.ts';
import type { ProfileData } from '../../shared/sync/profile.ts';

/** Como o Nimboo aparece neste aparelho. Guardado nas preferências locais (sincroniza na F5). */
export type Profile = ProfileData;

export const DEFAULT_PROFILE: Profile = { character: 'mochi', color: 'mint', name: 'Nimboo', skin: null };

/** Lê o perfil guardado; valores inválidos ou ausentes voltam ao padrão (nunca lança). */
export function parseProfile(text: string | null): Profile {
  if (!text) return { ...DEFAULT_PROFILE };
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const character = (CHARACTERS as readonly string[]).includes(String(raw.character)) ? (raw.character as CharacterId) : DEFAULT_PROFILE.character;
    const color = (MOCHI_COLORS as readonly string[]).includes(String(raw.color)) ? (raw.color as MochiColor) : DEFAULT_PROFILE.color;
    const name = typeof raw.name === 'string' && raw.name.trim().length > 0 && raw.name.length <= 24 ? raw.name.trim() : DEFAULT_PROFILE.name;
    // Só vale um acessório que exista e seja do personagem atual.
    const wanted = skinById(typeof raw.skin === 'string' ? raw.skin : null);
    const skin = wanted && wanted.character === character ? wanted.id : null;
    return { character, color, name, skin };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export const serializeProfile = (p: Profile): string => JSON.stringify(p);
