import type { Bubble } from './useSpeech';
import './speech.css';

interface SpeechBubbleProps {
  bubble: Bubble | null;
  /** `island`: abaixo da pílula (escuro). `floating`: acima da cabeça do Nimboo (claro). */
  placement: 'island' | 'floating';
}

/**
 * Balão de fala: só texto curto, sem interação (cliques atravessam). `role="status"` anuncia
 * a fala para leitores de tela sem tirar o foco de onde a pessoa está.
 */
export function SpeechBubble({ bubble, placement }: SpeechBubbleProps) {
  return (
    <div className="speech-layer" data-placement={placement} role="status" aria-live="polite">
      {bubble && (
        <div key={bubble.id} className="speech">
          {bubble.text}
        </div>
      )}
    </div>
  );
}
