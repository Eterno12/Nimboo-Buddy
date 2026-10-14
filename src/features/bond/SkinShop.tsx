import { useMemo, useState } from 'react';
import type { BondSnapshot } from '../../../shared/achievements';
import { SKINS, type SkinDef } from '../../../shared/skins';
import { CHARACTER_LABELS, type CharacterId } from '../../../shared/settings';
import { Mascot } from '../mascot/Mascot';

interface Props {
  bond: BondSnapshot;
  /** Personagem na área de trabalho (aparece primeiro). */
  character: CharacterId;
  /** Acessório em uso. */
  equipped: string | null;
  onEquip(id: string | null): void;
}

/** Loja de acessórios: gasta o saldo de pontos; a amizade e o total de pontos não mudam. */
export function SkinShop({ bond, character, equipped, onEquip }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const groups = useMemo(() => {
    const ids = [...new Set(SKINS.map((s) => s.character))];
    ids.sort((a, b) => (a === character ? -1 : b === character ? 1 : 0));
    return ids.map((id) => ({ id, label: CHARACTER_LABELS[id], skins: SKINS.filter((s) => s.character === id) }));
  }, [character]);

  const buy = async (skin: SkinDef) => {
    setBusy(skin.id);
    setFailed(null);
    try {
      const next = await window.mochi.bond.buySkin(skin.id);
      if (next) onEquip(skin.id);
      else setFailed(skin.id);
    } catch {
      setFailed(skin.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="shop" aria-label="Acessórios">
      <p className="shop-intro">
        Gaste seus pontos em acessórios. Comprar usa o saldo, mas não diminui o total de pontos nem a amizade.
      </p>
      {groups.map((g) => (
        <div key={g.id} className="shop-group">
          <h2>{g.id === character ? `${g.label} · seu personagem` : g.label}</h2>
          <ul className="shop-grid">
            {g.skins.map((s) => {
              const owned = bond.ownedSkins.includes(s.id);
              const using = equipped === s.id;
              const missing = Math.max(0, s.price - bond.balance);
              return (
                <li key={s.id} className="shop-card" data-owned={owned} data-using={using} data-testid="skin">
                  <div className="shop-preview" aria-hidden="true">
                    <Mascot
                      state="idle"
                      replay={0}
                      hop={false}
                      blinking={false}
                      mood="mid"
                      character={s.character}
                      skin={s.id}
                      uid={`shop-${s.id.replace('.', '-')}`}
                    />
                  </div>
                  <div className="shop-info">
                    <h3>{s.name}</h3>
                    <p>{s.description}</p>
                    {owned ? (
                      <button type="button" className="shop-btn" data-primary={!using} onClick={() => onEquip(using ? null : s.id)}>
                        {using ? 'Em uso · tirar' : 'Usar'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="shop-btn"
                        data-primary="true"
                        disabled={missing > 0 || busy !== null}
                        onClick={() => void buy(s)}
                      >
                        {missing > 0 ? `${s.price} pts · faltam ${missing}` : `Comprar · ${s.price} pts`}
                      </button>
                    )}
                    {failed === s.id && <p className="shop-error">Não foi possível comprar agora.</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
