import { useEffect, useMemo, useState } from 'react';
import { TIER_LABEL, type AchievementView } from '../../../shared/achievements';
import { CHARACTER_LABELS } from '../../../shared/settings';
import { SKINS, type SkinDef } from '../../../shared/skins';
import { Mascot } from '../../../src/features/mascot/Mascot';
import { AchievementIcon } from '../../../src/features/bond/AchievementIcon';
import type { Core } from '../core';
import type { Profile } from '../profile';
import { Icon } from '../ui/Icon';

interface Props {
  core: Core;
  profile: Profile;
  onProfile(next: Profile): void;
  onClose(): void;
}

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/** Conquistas (troféus) e loja de acessórios, em tela cheia. */
export function AchievementsScreen({ core, profile, onProfile, onClose }: Props) {
  const [tab, setTab] = useState<'achievements' | 'skins'>('achievements');
  const [, force] = useState(0);
  const snap = core.bond.snapshot();

  useEffect(() => core.subscribe(() => force((n) => n + 1)), [core]);
  useEffect(() => {
    history.pushState({ achievements: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onClose]);

  const list = useMemo(
    () =>
      [...snap.achievements].sort((x, y) => {
        if (x.unlocked !== y.unlocked) return x.unlocked ? -1 : 1;
        if (x.unlocked) return (y.unlockedAt ?? '').localeCompare(x.unlockedAt ?? '');
        return y.progress.fraction - x.progress.fraction;
      }),
    [snap.achievements],
  );

  const groups = useMemo(() => {
    const ids = [...new Set(SKINS.map((s) => s.character))];
    ids.sort((a, b) => (a === profile.character ? -1 : b === profile.character ? 1 : 0));
    return ids.map((id) => ({ id, label: CHARACTER_LABELS[id], skins: SKINS.filter((s) => s.character === id) }));
  }, [profile.character]);

  const buy = (skin: SkinDef) => {
    const next = core.bond.buySkin(skin.id);
    if (next) onProfile({ ...profile, character: skin.character, skin: skin.id });
  };

  return (
    <div className="full-screen" data-testid="achievements-screen">
      <header className="full-bar">
        <button type="button" className="icon-btn" aria-label="Voltar" data-testid="ach-back" onClick={() => history.back()}>
          <Icon name="chevron" size={22} />
        </button>
        <h1>Conquistas</h1>
        <span className="points" data-testid="ach-points">
          {snap.points}/{snap.maxPoints} pts · saldo {snap.balance}
        </span>
      </header>

      <div className="segmented wide" role="tablist" aria-label="Seção">
        <button type="button" role="tab" aria-selected={tab === 'achievements'} onClick={() => setTab('achievements')}>
          Conquistas ({snap.unlockedCount}/{snap.total})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'skins'} data-testid="ach-tab-skins" onClick={() => setTab('skins')}>
          Acessórios
        </button>
      </div>

      <div className="full-body">
        {tab === 'achievements' ? (
          <ul className="ach-list" data-testid="ach-list">
            {list.map((a: AchievementView) => (
              <li key={a.id} className="ach-row" data-tier={a.tier} data-unlocked={a.unlocked}>
                <span className="ach-medal">
                  <AchievementIcon name={a.icon} />
                </span>
                <span className="ach-text">
                  <strong>
                    {a.title} <em>{TIER_LABEL[a.tier]}</em>
                  </strong>
                  <span>{a.description}</span>
                  {a.unlocked ? (
                    <small>Conquistada em {formatDate(a.unlockedAt)}</small>
                  ) : a.hidden ? null : (
                    <span className="ach-progress">
                      <i style={{ width: `${Math.round(a.progress.fraction * 100)}%` }} />
                      <small>
                        {a.progress.current}/{a.progress.target}
                      </small>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div data-testid="skin-shop">
            <p className="muted">Comprar usa o saldo, mas não diminui seu total de pontos nem a amizade.</p>
            {groups.map((g) => (
              <section key={g.id}>
                <h2 className="shop-group">{g.id === profile.character ? `${g.label} · seu personagem` : g.label}</h2>
                <ul className="shop-grid">
                  {g.skins.map((s) => {
                    const owned = snap.ownedSkins.includes(s.id);
                    const using = profile.skin === s.id;
                    const missing = Math.max(0, s.price - snap.balance);
                    return (
                      <li key={s.id} className="shop-card" data-using={using} data-testid="skin">
                        <span className="shop-preview">
                          <Mascot state="idle" replay={0} hop={false} blinking={false} mood="mid" character={s.character} skin={s.id} palette={profile.color} uid={`sh-${s.id.replace('.', '-')}`} />
                        </span>
                        <span className="shop-info">
                          <strong>{s.name}</strong>
                          <small>{s.description}</small>
                          {owned ? (
                            <button
                              type="button"
                              className={using ? 'btn-soft' : 'btn-primary'}
                              onClick={() => onProfile({ ...profile, character: s.character, skin: using ? null : s.id })}
                            >
                              {using ? 'Em uso · tirar' : 'Usar'}
                            </button>
                          ) : (
                            <button type="button" className="btn-primary" disabled={missing > 0} data-testid={`buy-${s.id}`} onClick={() => buy(s)}>
                              {missing > 0 ? `${s.price} pts · faltam ${missing}` : `Comprar · ${s.price} pts`}
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
