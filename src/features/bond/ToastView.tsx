import { useEffect, useState } from 'react';
import { TIER_LABEL, TIER_POINTS, type AchievementView } from '../../../shared/achievements';
import { characterInfo } from '../mascot/characters';
import { configureSound, playSound } from '../audio/soundEngine';
import { useSettings } from '../settings/useSettings';
import { useTheme } from '../settings/useTheme';
import { AchievementIcon } from './AchievementIcon';
import './bond.css';

/** Aviso de conquista (janela sem foco, no canto da tela): cartão no estilo "troféu desbloqueado". */
export function ToastView({ id }: { id: string }) {
  const { settings, ready } = useSettings();
  const theme = useTheme(settings.theme);
  const [item, setItem] = useState<AchievementView | null>(null);

  // A janela é transparente: o fundo opaco que o tema põe no documento não vale aqui.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, [theme]);

  useEffect(() => {
    let alive = true;
    void window.mochi.bond
      .get()
      .then((s) => {
        if (alive) setItem(s?.achievements.find((a) => a.id === id) ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!ready || !item) return;
    configureSound({
      enabled: settings.soundEnabled,
      volume: settings.soundVolume,
      profile: characterInfo(settings.character).sound,
    });
    playSound('achievement');
  }, [ready, item, settings.soundEnabled, settings.soundVolume, settings.character]);

  if (!item) return <main className="ach-toast-host" data-theme={theme} />;

  return (
    <main className="ach-toast-host" data-theme={theme}>
      <div className="ach-toast" data-tier={item.tier} role="status">
        <div className="ach-medal" aria-hidden="true">
          <AchievementIcon name={item.icon} />
        </div>
        <div className="ach-toast-text">
          <span className="ach-toast-kicker">Conquista desbloqueada · {TIER_LABEL[item.tier]}</span>
          <strong>{item.title}</strong>
          <span className="ach-toast-desc">
            {item.description} · +{TIER_POINTS[item.tier]} pts
          </span>
        </div>
      </div>
    </main>
  );
}
