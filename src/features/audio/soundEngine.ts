import {
  applyProfile,
  NEUTRAL_PROFILE,
  SOUNDS,
  voicePlan,
  type Note,
  type SoundName,
  type SoundProfile,
} from './sounds';

/**
 * Toca os sons do Mochi com WebAudio (sintetizados, sem arquivos). Vive no renderer; cada janela
 * tem o seu. Configuração (ligado, volume e identidade sonora do personagem) vem das preferências.
 */
let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 0.4;
let profile: SoundProfile = NEUTRAL_PROFILE;

/** Máximo de sons "ativos" ao mesmo tempo; passou disso, o mais antigo ainda tocando é ignorado. */
const MAX_OVERLAP = 4;
let activeUntil: number[] = [];

export function configureSound(options: { enabled: boolean; volume: number; profile?: SoundProfile }): void {
  enabled = options.enabled;
  volume = Math.min(1, Math.max(0, options.volume));
  profile = options.profile ?? NEUTRAL_PROFILE;
  if (master) master.gain.value = volume;
}

function ensureContext(): { ctx: AudioContext; out: AudioNode } | null {
  try {
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = volume;
      // Passa-baixas: tira o "brilho" duro dos osciladores (som mais "lo-fi", macio).
      const soften = context.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 3200;
      master.connect(soften).connect(context.destination);
    }
    if (context.state === 'suspended') void context.resume();
    return { ctx: context, out: master as AudioNode };
  } catch {
    return null; // sem áudio disponível: o app segue em silêncio
  }
}

function schedule(notes: readonly Note[]): void {
  const audio = ensureContext();
  if (!audio) return;
  const { ctx, out } = audio;
  // Evita acumular sons: descarta o que já passou e ignora quando há sons demais em curso.
  const now = ctx.currentTime;
  activeUntil = activeUntil.filter((t) => t > now);
  if (activeUntil.length >= MAX_OVERLAP) return;
  const start = now + 0.01;
  let end = start;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = n.wave;
    const t0 = start + n.at;
    osc.frequency.setValueAtTime(n.freq, t0);
    if (n.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, n.glideTo), t0 + n.dur);
    if (n.vibrato) {
      // LFO lento na frequência (em cents): timidez do cogumelo, "uuuu" do fantasma.
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = n.vibrato;
      lfo.connect(depth).connect(osc.detune);
      lfo.start(t0);
      lfo.stop(t0 + n.dur + 0.02);
    }
    // Envelope: ataque curtíssimo (sem estalo) e queda exponencial.
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, n.gain), t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
    osc.connect(env).connect(out);
    osc.start(t0);
    osc.stop(t0 + n.dur + 0.02);
    end = Math.max(end, t0 + n.dur + 0.02);
  }
  activeUntil.push(end);
}

/** Toca um som pelo nome (nada acontece com os sons desligados). */
export function playSound(name: SoundName): void {
  if (!enabled || volume <= 0) return;
  schedule(applyProfile(SOUNDS[name], profile));
}

/** A "voz" do balão para uma frase. */
export function playVoice(text: string): void {
  if (!enabled || volume <= 0) return;
  schedule(voicePlan(text, Math.random, profile));
}
