import { useMemo, useState } from 'react';
import { TIER_LABEL, type AchievementView } from '../../../shared/achievements';
import { Mascot } from '../mascot/Mascot';
import { useSettings } from '../settings/useSettings';
import { useTheme } from '../settings/useTheme';
import { AchievementIcon } from './AchievementIcon';
import { useBond } from './useBond';
import { SkinShop } from './SkinShop';
import { WeekSection } from './WeekSection';
import './bond.css';

type Filter = 'all' | 'unlocked' | 'locked';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'unlocked', label: 'Conquistadas' },
  { id: 'locked', label: 'Bloqueadas' },
];

const formatDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Tile({ a }: { a: AchievementView }) {
  const pct = Math.round(a.progress.fraction * 100);
  return (
    <li className="ach-tile" data-tier={a.tier} data-unlocked={a.unlocked} data-hidden={a.hidden} data-testid="achievement">
      <div className="ach-medal" aria-hidden="true">
        <AchievementIcon name={a.icon} />
      </div>
      <div className="ach-body">
        <div className="ach-title-row">
          <h3>{a.title}</h3>
          <span className="ach-tier">{TIER_LABEL[a.tier]}</span>
        </div>
        <p>{a.description}</p>
        {a.unlocked ? (
          <p className="ach-date">Conquistada em {formatDate(a.unlockedAt)}</p>
        ) : a.hidden ? null : (
          <div className="ach-progress">
            <div className="ach-bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.progress.target} aria-valuenow={a.progress.current}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="ach-count">
              {a.progress.current}/{a.progress.target}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

/** Janela de conquistas: perfil de amizade e troféus no estilo de Steam/PSN. */
export function AchievementsView() {
  const { settings } = useSettings();
  const theme = useTheme(settings.theme);
  const bond = useBond();
  const [filter, setFilter] = useState<Filter>('all');
  const [tab, setTab] = useState<'achievements' | 'skins'>('achievements');

  const list = useMemo(() => {
    const all = bond?.achievements ?? [];
    const shown = all.filter((a) => (filter === 'all' ? true : filter === 'unlocked' ? a.unlocked : !a.unlocked));
    // Conquistadas primeiro (mais recentes no topo); depois as que estão mais perto de sair.
    return [...shown].sort((x, y) => {
      if (x.unlocked !== y.unlocked) return x.unlocked ? -1 : 1;
      if (x.unlocked) return (y.unlockedAt ?? '').localeCompare(x.unlockedAt ?? '');
      return y.progress.fraction - x.progress.fraction;
    });
  }, [bond, filter]);

  if (!bond) {
    return (
      <main className="ach" data-theme={theme}>
        <p className="ach-empty">Carregando…</p>
      </main>
    );
  }

  const totalPct = bond.total === 0 ? 0 : Math.round((bond.unlockedCount / bond.total) * 100);
  const streak = bond.stats.streak ?? 0;
  const days = bond.stats.days_total ?? 0;

  return (
    <main className="ach" data-theme={theme}>
      <header className="ach-profile">
        <div className="ach-avatar" aria-hidden="true">
          <Mascot
            state="happy"
            replay={0}
            hop={false}
            blinking={false}
            mood="high"
            character={settings.character}
            palette={settings.color} skin={settings.skin}
            uid="ach"
          />
        </div>
        <div className="ach-profile-text">
          <h1>{settings.mascotName}</h1>
          <p className="ach-bond-title">{bond.title}</p>
          <p className="ach-line">
            {plural(days, 'dia juntos', 'dias juntos')} · sequência de {plural(streak, 'dia', 'dias')}
          </p>
        </div>
        <div className="ach-score" aria-label={`${bond.points} de ${bond.maxPoints} pontos`}>
          <strong>{bond.points}</strong>
          <span>/ {bond.maxPoints} pts</span>
          <span className="ach-balance" data-testid="balance">Saldo: {bond.balance} pts</span>
        </div>
      </header>

      <div className="ach-tabs" role="tablist" aria-label="Seção">
        <button type="button" role="tab" aria-selected={tab === 'achievements'} className="ach-filter" onClick={() => setTab('achievements')}>
          Conquistas
        </button>
        <button type="button" role="tab" aria-selected={tab === 'skins'} className="ach-filter" data-testid="tab-skins" onClick={() => setTab('skins')}>
          Acessórios
        </button>
      </div>

      {tab === 'skins' ? (
        <SkinShop
          bond={bond}
          character={settings.character}
          equipped={settings.skin}
          onEquip={(id) => void window.mochi.settings.update({ skin: id })}
        />
      ) : (
        <>
      <section className="ach-summary" aria-label="Resumo">
        <div className="ach-bar big" role="progressbar" aria-valuemin={0} aria-valuemax={bond.total} aria-valuenow={bond.unlockedCount}>
          <span style={{ width: `${totalPct}%` }} />
        </div>
        <p>
          {bond.unlockedCount} de {bond.total} conquistas · {totalPct}%
        </p>
      </section>

      <WeekSection
        streak={streak}
        refreshKey={(bond.stats.tasks_completed ?? 0) * 1000 + (bond.stats.focus_sessions ?? 0)}
      />

      <div className="ach-filters" role="tablist" aria-label="Filtro">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className="ach-filter"
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ul className="ach-list">
        {list.map((a) => (
          <Tile key={a.id} a={a} />
        ))}
        {list.length === 0 && <li className="ach-empty">Nada por aqui ainda.</li>}
      </ul>
        </>
      )}
    </main>
  );
}
