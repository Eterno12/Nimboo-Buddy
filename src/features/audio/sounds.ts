/**
 * Sons do Mochi: dados puros (sem DOM, testáveis). Tudo é sintetizado em tempo real com
 * WebAudio: nenhum arquivo de áudio, nenhum som alto, nada que dure mais de ~1,5 s.
 * A intenção é "lo-fi tranquilo": tecs curtos, sininhos suaves e uma vozinha fina.
 */

export type WaveShape = 'sine' | 'triangle';

export interface Note {
  /** Início, em segundos, a partir do começo do som. */
  at: number;
  /** Frequência inicial (Hz). */
  freq: number;
  /** Duração (s). */
  dur: number;
  /** Volume relativo (0..1) antes do volume geral. */
  gain: number;
  wave: WaveShape;
  /** Se presente, a frequência desliza até este valor (bicos e tecs). */
  glideTo?: number;
}

export type SoundName =
  | 'tick' // tec
  | 'tickTick' // tec-tec
  | 'pause'
  | 'resume'
  | 'taskDone'
  | 'focusStart'
  | 'focusDone'
  | 'breakDone'
  | 'preview';

/** Limites que todo som precisa respeitar (verificados em `tests/sounds.test.ts`). */
export const SOUND_LIMITS = { maxDuration: 1.6, maxGain: 0.6, minFreq: 150, maxFreq: 2400 } as const;

const tec = (at: number, freq: number, gain = 0.5): Note => ({
  at,
  freq,
  dur: 0.06,
  gain,
  wave: 'triangle',
  glideTo: freq * 0.7,
});

const bell = (at: number, freq: number, dur: number, gain: number): Note => ({
  at,
  freq,
  dur,
  gain,
  wave: 'sine',
});

export const SOUNDS: Record<SoundName, readonly Note[]> = {
  tick: [tec(0, 520)],
  tickTick: [tec(0, 520), tec(0.11, 440, 0.42)],
  pause: [tec(0, 360, 0.42)],
  resume: [tec(0, 620, 0.42)],
  // dois sininhos subindo (E5 → B5)
  taskDone: [bell(0, 659.25, 0.18, 0.38), bell(0.09, 987.77, 0.34, 0.34)],
  focusStart: [tec(0, 480), tec(0.12, 480, 0.45), tec(0.24, 640, 0.5)],
  // arpejo C5 E5 G5 C6, devagar e macio
  focusDone: [
    bell(0, 523.25, 0.5, 0.34),
    bell(0.16, 659.25, 0.5, 0.32),
    bell(0.32, 783.99, 0.55, 0.3),
    bell(0.5, 1046.5, 0.8, 0.28),
  ],
  // volta do descanso: E5 → A5, uma pergunta suave
  breakDone: [bell(0, 659.25, 0.3, 0.34), bell(0.15, 880, 0.5, 0.32)],
  preview: [bell(0, 587.33, 0.2, 0.36), bell(0.12, 880, 0.3, 0.32)],
};

/** Fim do som (último início + duração), em segundos. */
export function planDuration(notes: readonly Note[]): number {
  return notes.reduce((end, n) => Math.max(end, n.at + n.dur), 0);
}

/** Notas (em Hz) da "voz" do balão: pentatônica aguda, sempre agradável. */
const VOICE_SCALE = [698.46, 783.99, 880, 1046.5, 1174.66];

/**
 * "Tu-tu-tu" do balão: uma sequência de bips finos, mais longa para frases maiores.
 * `random` é injetável para testes (deve devolver valores em [0, 1)).
 */
export function voicePlan(text: string, random: () => number = Math.random): Note[] {
  const letters = [...text].filter((c) => /\p{L}/u.test(c)).length;
  const blips = Math.min(9, Math.max(3, Math.ceil(letters / 3)));
  const notes: Note[] = [];
  let at = 0;
  let last = -1;
  for (let i = 0; i < blips; i++) {
    let index = Math.floor(random() * VOICE_SCALE.length);
    if (index === last) index = (index + 2) % VOICE_SCALE.length; // evita repetir a mesma nota
    last = index;
    const freq = VOICE_SCALE[index];
    notes.push({ at, freq, dur: 0.055, gain: 0.3, wave: 'sine', glideTo: freq * (1 + (random() - 0.35) * 0.08) });
    at += 0.085;
  }
  return notes;
}
