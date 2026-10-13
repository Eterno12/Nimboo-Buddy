import { useEffect } from 'react';
import {
  DEFAULT_SETTINGS,
  HIDE_DELAYS_SEC,
  ISLAND_SCALES,
  MOCHI_COLORS,
  MOCHI_SCALES,
  SHORTCUT_PRESETS,
  type MochiColor,
  type Settings,
} from '../../../shared/settings';
import { configureSound, playSound } from '../audio/soundEngine';
import { useSettings } from './useSettings';
import './settings.css';

const COLOR_LABEL: Record<MochiColor, string> = {
  mint: 'Menta',
  peach: 'Pêssego',
  sky: 'Céu',
  lilac: 'Lilás',
  lemon: 'Limão',
  rose: 'Rosa',
};

/** Só para pintar as amostras (as paletas reais ficam em `mascot.css`). */
const COLOR_SWATCH: Record<MochiColor, [string, string]> = {
  mint: ['#e4fbd4', '#8fd9a8'],
  peach: ['#ffeadb', '#ffb590'],
  sky: ['#e3f4ff', '#8ec9f6'],
  lilac: ['#f1e8ff', '#c5a8f3'],
  lemon: ['#fffbd6', '#f5de72'],
  rose: ['#ffe6ee', '#ffa3bb'],
};

const percent = (v: number) => `${Math.round(v * 100)}%`;

const shortcutLabel = (accelerator: string) =>
  accelerator.replace('Control', 'Ctrl').replace('Space', 'Espaço').replaceAll('+', ' + ');

const hideLabel = (seconds: number) => (seconds === 0 ? 'Nunca (a ilha fica sempre à vista)' : `${seconds} segundos`);

interface SettingsViewProps {
  onBack: () => void;
}

/** Tela de configurações (no painel). Cada mudança vale na hora e é salva pelo processo principal. */
export function SettingsView({ onBack }: SettingsViewProps) {
  const { settings, packaged, shortcutActive, effective, update } = useSettings();

  // O botão "Ouvir" toca nesta janela: usa os mesmos valores salvos.
  useEffect(() => {
    configureSound({ enabled: settings.soundEnabled, volume: settings.soundVolume });
  }, [settings.soundEnabled, settings.soundVolume]);

  const set = (patch: Partial<Omit<Settings, 'version'>>) => void update(patch);
  const resetAll = () =>
    set({
      islandScale: DEFAULT_SETTINGS.islandScale,
      mochiScale: DEFAULT_SETTINGS.mochiScale,
      hideDelaySec: DEFAULT_SETTINGS.hideDelaySec,
      shortcut: DEFAULT_SETTINGS.shortcut,
      soundEnabled: DEFAULT_SETTINGS.soundEnabled,
      soundVolume: DEFAULT_SETTINGS.soundVolume,
      bubbles: DEFAULT_SETTINGS.bubbles,
      doNotDisturb: DEFAULT_SETTINGS.doNotDisturb,
      color: DEFAULT_SETTINGS.color,
    });

  const clamped = (requested: number, effectiveValue: number) =>
    effectiveValue + 0.001 < requested ? `Limitado a ${percent(effectiveValue)} para caber no seu monitor.` : null;

  return (
    <section className="settings" aria-label="Configurações">
      <header className="settings-header">
        <button type="button" className="settings-back" onClick={onBack} aria-label="Voltar ao painel">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2>Configurações</h2>
      </header>

      <fieldset className="settings-group">
        <legend>Tamanho da ilha</legend>
        <div className="settings-chips" role="radiogroup" aria-label="Tamanho da ilha">
          {ISLAND_SCALES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={settings.islandScale === s}
              className="settings-chip"
              onClick={() => set({ islandScale: s })}
            >
              {percent(s)}
            </button>
          ))}
        </div>
        <p className="settings-hint">{clamped(settings.islandScale, effective.islandScale) ?? 'Vale na hora.'}</p>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Tamanho do Mochi solto</legend>
        <div className="settings-chips" role="radiogroup" aria-label="Tamanho do Mochi solto">
          {MOCHI_SCALES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={settings.mochiScale === s}
              className="settings-chip"
              onClick={() => set({ mochiScale: s })}
            >
              {percent(s)}
            </button>
          ))}
        </div>
        <p className="settings-hint">
          {clamped(settings.mochiScale, effective.mochiScale) ??
            'No modo flutuante e quando o Mochi aparece no canto da tela.'}
        </p>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Cor do Mochi</legend>
        <div className="settings-swatches" role="radiogroup" aria-label="Cor do Mochi">
          {MOCHI_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={settings.color === c}
              aria-label={COLOR_LABEL[c]}
              title={COLOR_LABEL[c]}
              className="settings-swatch"
              style={{ background: `radial-gradient(circle at 35% 30%, ${COLOR_SWATCH[c][0]}, ${COLOR_SWATCH[c][1]})` }}
              onClick={() => set({ color: c })}
            />
          ))}
        </div>
        <p className="settings-hint">Em breve: outros personagens além do blob.</p>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Comportamento</legend>
        <label className="settings-row">
          <span>Esconder a ilha depois de</span>
          <select value={settings.hideDelaySec} onChange={(e) => set({ hideDelaySec: Number(e.target.value) })}>
            {HIDE_DELAYS_SEC.map((s) => (
              <option key={s} value={s}>
                {hideLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.doNotDisturb}
            onChange={(e) => set({ doNotDisturb: e.target.checked })}
          />
          <span>
            Não incomodar: sair da frente quando um app estiver em tela cheia
            <small>Jogos, vídeos e apresentações.</small>
          </span>
        </label>
        <label className="settings-row settings-check">
          <input type="checkbox" checked={settings.bubbles} onChange={(e) => set({ bubbles: e.target.checked })} />
          <span>
            Balões de fala
            <small>O Mochi comenta de vez em quando; fica quieto durante o foco.</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Sons</legend>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.soundEnabled}
            onChange={(e) => set({ soundEnabled: e.target.checked })}
          />
          <span>
            Sons suaves
            <small>Tec ao criar tarefas, sininhos ao concluir e uma vozinha nos balões.</small>
          </span>
        </label>
        <div className="settings-row">
          <label htmlFor="settings-volume">Volume</label>
          <input
            id="settings-volume"
            type="range"
            min={0}
            max={100}
            step={5}
            disabled={!settings.soundEnabled}
            value={Math.round(settings.soundVolume * 100)}
            onChange={(e) => set({ soundVolume: Number(e.target.value) / 100 })}
          />
          <button
            type="button"
            className="settings-small"
            disabled={!settings.soundEnabled}
            onClick={() => playSound('preview')}
          >
            Ouvir
          </button>
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Atalho e inicialização</legend>
        <label className="settings-row">
          <span>Atalho para chamar a ilha</span>
          <select
            value={settings.shortcut ?? ''}
            onChange={(e) => set({ shortcut: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">Desligado</option>
            {SHORTCUT_PRESETS.map((a) => (
              <option key={a} value={a}>
                {shortcutLabel(a)}
              </option>
            ))}
          </select>
        </label>
        {settings.shortcut && (
          <p className="settings-hint" data-tone={shortcutActive ? 'ok' : 'warn'} role="status">
            {shortcutActive
              ? 'Ativo: abre a ilha direto nas tarefas.'
              : 'Não foi possível registrar: outro programa já usa este atalho. Escolha outro.'}
          </p>
        )}
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            disabled={!packaged}
            onChange={(e) => set({ launchAtLogin: e.target.checked })}
          />
          <span>
            Iniciar com o Windows
            <small>
              {packaged
                ? 'Abre o Mochi quando você entrar no computador.'
                : 'Disponível quando o Mochi estiver instalado (esta é a versão de desenvolvimento).'}
            </small>
          </span>
        </label>
      </fieldset>

      <div className="settings-footer">
        <button type="button" className="settings-small" onClick={resetAll}>
          Restaurar padrões
        </button>
      </div>
    </section>
  );
}
