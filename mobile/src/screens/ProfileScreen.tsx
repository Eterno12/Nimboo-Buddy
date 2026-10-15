import { CHARACTER_LABELS, CHARACTERS, MOCHI_COLORS, type MochiColor } from '../../../shared/settings';
import { Mascot } from '../../../src/features/mascot/Mascot';
import { characterInfo } from '../../../src/features/mascot/characters';
import type { Core } from '../core';
import type { Profile } from '../profile';
import { AccountPanel } from './AccountPanel';

const COLOR_LABEL: Record<MochiColor, string> = { mint: 'Menta', peach: 'Pêssego', sky: 'Céu', lilac: 'Lilás', lemon: 'Limão', rose: 'Rosa' };

interface Props {
  core: Core;
  profile: Profile;
  onChange(next: Profile): void;
}

/** Perfil: personagem, cor, nome e conta. */
export function ProfileScreen({ core, profile, onChange }: Props) {
  return (
    <div className="screen" data-testid="screen-profile">
      <header className="screen-head">
        <h1>Perfil</h1>
      </header>

      <section className="card" aria-labelledby="char-h">
        <h2 id="char-h">Personagem</h2>
        <div className="char-grid" role="radiogroup" aria-label="Personagem">
          {CHARACTERS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={profile.character === id}
              className="char-option"
              data-testid={`char-${id}`}
              onClick={() => onChange({ ...profile, character: id })}
            >
              <span className="char-art">
                <Mascot state="idle" replay={0} hop={false} blinking={false} mood="mid" character={id} palette={profile.color} uid={`pf-${id}`} />
              </span>
              <span>{CHARACTER_LABELS[id]}</span>
            </button>
          ))}
        </div>
        <p className="muted">{characterInfo(profile.character).tagline}</p>

        {profile.character === 'mochi' && (
          <div className="field">
            <span>Cor</span>
            <div className="swatches" role="radiogroup" aria-label="Cor do Nimboo">
              {MOCHI_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={profile.color === c}
                  aria-label={COLOR_LABEL[c]}
                  className="swatch"
                  data-color={c}
                  onClick={() => onChange({ ...profile, color: c })}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <AccountPanel core={core} />

      <p className="muted small">Nimboo para Android · versão de testes</p>
    </div>
  );
}
