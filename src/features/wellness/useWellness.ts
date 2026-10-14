import { useEffect, useRef } from 'react';
import type { Settings } from '../../../shared/settings';
import {
  commitNudge,
  dueNudge,
  initWellness,
  restartKind,
  WELLNESS_KINDS,
  type WellnessConfig,
  type WellnessKind,
  type WellnessState,
} from '../../../shared/wellness';

const TICK_MS = 30_000;

export const wellnessConfigOf = (s: Settings): WellnessConfig => ({
  water: { on: s.wellnessWater, minutes: s.wellnessWaterMin },
  posture: { on: s.wellnessPosture, minutes: s.wellnessPostureMin },
  eyes: { on: s.wellnessEyes, minutes: s.wellnessEyesMin },
});

interface Options {
  settings: Settings;
  /** Foco em andamento, ilha escondida ou outra razão para não interromper agora. */
  blocked: boolean;
  /** Mostra o balão; devolve `false` se não foi exibido (o lembrete fica para a próxima checagem). */
  say(text: string): boolean;
  onNudge(kind: WellnessKind): void;
}

/** Lembretes de bem-estar no mascote: confere a cada 30 s se algum venceu. Nada roda com tudo desligado. */
export function useWellness({ settings, blocked, say, onNudge }: Options): void {
  const state = useRef<WellnessState | null>(null);
  const config = wellnessConfigOf(settings);
  const configKey = JSON.stringify(config);
  const prevConfig = useRef<WellnessConfig | null>(null);
  const live = useRef({ blocked, say, onNudge, config });
  live.current = { blocked, say, onNudge, config };

  // Ligar um lembrete (ou trocar o intervalo) recomeça a contagem dele.
  useEffect(() => {
    const now = Date.now();
    if (!state.current) state.current = initWellness(now);
    const before = prevConfig.current;
    if (before) {
      for (const kind of WELLNESS_KINDS) {
        const a = before[kind];
        const b = config[kind];
        if (a.on !== b.on || a.minutes !== b.minutes) state.current = restartKind(state.current, kind, now);
      }
    }
    prevConfig.current = config;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  const anyOn = config.water.on || config.posture.on || config.eyes.on;
  useEffect(() => {
    if (!anyOn) return;
    const timer = window.setInterval(() => {
      const s = state.current;
      if (!s) return;
      const l = live.current;
      const hidden = document.visibilityState === 'hidden';
      const nudge = dueNudge(s, l.config, Date.now(), l.blocked || hidden);
      if (!nudge) return;
      if (l.say(nudge.text)) {
        state.current = commitNudge(s, nudge.kind, Date.now());
        l.onNudge(nudge.kind);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [anyOn]);
}
