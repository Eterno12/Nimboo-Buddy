import { CHARACTER_LABELS, CHARACTERS, MOCHI_COLORS, type MochiColor } from '../../../shared/settings';
import { Mascot } from '../../../src/features/mascot/Mascot';
import { characterInfo } from '../../../src/features/mascot/characters';
import type { Core } from '../core';
import type { Profile } from '../profile';
import { REMINDER_LEADS } from '../reminders';
import { playSound, readSoundPrefs, saveSoundPrefs } from '../sound';
import { AccountPanel } from './AccountPanel';

const COLOR_LABEL: Record<MochiColor, string> = { mint: 'Menta', peach: 'Pêssego', sky: 'Céu', lilac: 'Lilás', lemon: 'Limão', rose: 'Rosa' };

interface Props {
  core: Core;
  profile: Profile;
  onChange(next: Profile): void;
  onOpenAchievements(): void;
}

/** Perfil: personagem, cor, nome e conta. */
export function ProfileScreen({ core, profile, onChange, onOpenAchievements }: Props) {
  const snap = core.bond.snapshot();
  const reminders = core.reminderConfig();
  const sound = readSoundPrefs(core);
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
                <Mascot state="idle" replay={0} hop={false} blinking={false} mood="mid" character={id} palette={profile.color} skin={profile.skin} uid={`pf-${id}`} />
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

      <button type="button" className="card link-card" data-testid="open-achievements" onClick={onOpenAchievements}>
        <span>
          <strong>Conquistas e acessórios</strong>
          <small className="muted">
            {snap.unlockedCount}/{snap.total} conquistas · {snap.points} pts (saldo {snap.balance})
          </small>
        </span>
      </button>

      <section className="card" aria-labelledby="rem-h">
        <h2 id="rem-h">Lembretes de prazo</h2>
        <label className="check-row">
          <input
            type="checkbox"
            checked={reminders.enabled}
            data-testid="reminders-enabled"
            onChange={(e) => {
              if (e.target.checked) void core.notifier.requestPermission();
              core.setReminderConfig({ ...reminders, enabled: e.target.checked });
            }}
          />
          <span>Avisar quando uma tarefa com prazo estiver chegando (com botões Concluir e Adiar).</span>
        </label>
        <label className="field">
          <span>Avisar antes</span>
          <select
            value={reminders.leadMinutes}
            disabled={!reminders.enabled}
            data-testid="reminders-lead"
            onChange={(e) => core.setReminderConfig({ ...reminders, leadMinutes: Number(e.target.value) })}
          >
            {REMINDER_LEADS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Só na hora' : `${m} minutos antes`}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card" aria-labelledby="snd-h">
        <h2 id="snd-h">Sons</h2>
        <label className="check-row">
          <input
            type="checkbox"
            checked={sound.enabled}
            data-testid="sound-enabled"
            onChange={(e) => {
              saveSoundPrefs(core, { ...sound, enabled: e.target.checked });
              if (e.target.checked) playSound('preview');
            }}
          />
          <span>Sons discretos ao concluir tarefas, no foco e nas conquistas.</span>
        </label>
        <label className="field">
          <span>Volume ({Math.round(sound.volume * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sound.volume}
            disabled={!sound.enabled}
            data-testid="sound-volume"
            onChange={(e) => saveSoundPrefs(core, { ...sound, volume: Number(e.target.value) })}
            onPointerUp={() => playSound('preview')}
          />
        </label>
      </section>

      <AccountPanel core={core} />

      <p className="muted small">Nimboo para Android · versão de testes</p>
    </div>
  );
}
