/** Sons do app (mesmos do PC, sintetizados). Preferência só deste aparelho. */
export interface SoundPrefs {
  enabled: boolean;
  volume: number;
}

export const DEFAULT_SOUND_PREFS: SoundPrefs = { enabled: true, volume: 0.4 };

export function parseSoundPrefs(raw: string | null): SoundPrefs {
  try {
    const v = JSON.parse(raw ?? '{}') as Partial<SoundPrefs>;
    const volume = typeof v.volume === 'number' && Number.isFinite(v.volume) ? v.volume : DEFAULT_SOUND_PREFS.volume;
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SOUND_PREFS.enabled,
      volume: Math.round(Math.min(1, Math.max(0, volume)) * 20) / 20,
    };
  } catch {
    return { ...DEFAULT_SOUND_PREFS };
  }
}
