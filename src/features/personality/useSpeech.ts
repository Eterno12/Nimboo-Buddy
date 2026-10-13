import { useCallback, useEffect, useRef, useState } from 'react';
import { playVoice } from '../audio/soundEngine';
import type { Mood } from '../mascot/mascotStates';
import {
  bubbleDurationMs,
  createPersonality,
  type Personality,
  type SpeechEvent,
} from './personality';

export interface Bubble {
  /** Muda a cada fala (reinicia a animação mesmo com o mesmo texto). */
  id: number;
  text: string;
}

interface SpeechOptions {
  /** Balões ligados nas preferências. */
  enabled: boolean;
  mood: Mood;
  /** Há uma sessão de foco em andamento. */
  focusActive: boolean;
  /** A ilha está aberta: sem balões por cima do conteúdo. */
  suppressed: boolean;
}

/**
 * O Mochi "fala": escolhe a frase (personalidade), mostra o balão por um tempo proporcional ao
 * texto e toca a vozinha. Avisa o main quando há balão para a forma da janela incluí-lo.
 */
export function useSpeech({ enabled, mood, focusActive, suppressed }: SpeechOptions) {
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const personality = useRef<Personality | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const counter = useRef(0);
  // Valores correntes lidos dentro de `say` sem recriar o callback a cada render.
  const live = useRef({ enabled, mood, focusActive, suppressed });
  live.current = { enabled, mood, focusActive, suppressed };

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setBubble(null);
  }, []);

  const say = useCallback((event: SpeechEvent) => {
    const now = live.current;
    if (!now.enabled || now.suppressed) return;
    personality.current ??= createPersonality();
    const text = personality.current.pick(event, { now: new Date(), mood: now.mood, focusActive: now.focusActive });
    if (!text) return;
    window.clearTimeout(timer.current);
    setBubble({ id: ++counter.current, text });
    playVoice(text);
    timer.current = window.setTimeout(() => setBubble(null), bubbleDurationMs(text));
  }, []);

  // Desligar os balões, ou abrir a ilha, tira o balão da tela na hora.
  useEffect(() => {
    if (!enabled || suppressed) hide();
  }, [enabled, suppressed, hide]);

  // A forma da janela (ilha recolhida) cresce para abrigar o balão só enquanto ele existe.
  useEffect(() => {
    window.mochi.bubbleVisible(bubble !== null);
  }, [bubble]);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.mochi.bubbleVisible(false);
    },
    [],
  );

  return { bubble, say };
}
