import { configureSound, playSound } from '../../src/features/audio/soundEngine';
import { characterInfo } from '../../src/features/mascot/characters';
import type { Core } from './core';
import { parseSoundPrefs, type SoundPrefs } from './soundPrefs';

export { DEFAULT_SOUND_PREFS, parseSoundPrefs, type SoundPrefs } from './soundPrefs';

const PREF_KEY = 'sound';

export const readSoundPrefs = (core: Core): SoundPrefs => parseSoundPrefs(core.getPref(PREF_KEY));

export function saveSoundPrefs(core: Core, prefs: SoundPrefs): void {
  core.setPref(PREF_KEY, JSON.stringify(prefs));
  applySound(core);
}

/** Aplica preferências e a identidade sonora do personagem atual ao motor de áudio. */
export function applySound(core: Core): void {
  const prefs = readSoundPrefs(core);
  configureSound({ enabled: prefs.enabled, volume: prefs.volume, profile: characterInfo(core.getProfile().character).sound });
}

export { playSound };
