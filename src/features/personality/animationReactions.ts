import type { MascotState } from '../mascot/mascotStates.ts';
import type { SoundName } from '../audio/sounds.ts';
import type { SpeechEvent } from './personality.ts';

/**
 * Som e fala de cada animação do Mochi. `celebrate` e `idle` ficam de fora de propósito: celebrar
 * tem som e fala próprios, tocados pelo evento que o causa (tarefa concluída, fim do foco).
 */
export const ANIMATION_SOUND: Partial<Record<MascotState, SoundName>> = {
  happy: 'happy',
  curious: 'curious',
  surprised: 'surprised',
  giggle: 'giggle',
  annoyed: 'annoyed',
  grabbed: 'grabbed',
  yawn: 'yawn',
  stretch: 'stretch',
  lookaround: 'lookaround',
  sleepy: 'sleepy',
};

export const ANIMATION_LINE: Partial<Record<MascotState, SpeechEvent>> = {
  happy: 'happy',
  curious: 'curious',
  surprised: 'surprised',
  giggle: 'giggle',
  annoyed: 'annoyed',
  grabbed: 'grabbed',
  yawn: 'yawn',
  stretch: 'stretch',
  lookaround: 'lookaround',
  sleepy: 'sleepy',
};
