import { useEffect, useState } from 'react';
import { Mascot } from '../mascot/Mascot';
import { characterInfo } from '../mascot/characters';
import {
  CHARACTERS,
  DEFAULT_SETTINGS,
  HIDE_DELAYS_SEC,
  MODEL_NAME_RE,
  ISLAND_SCALES,
  MOCHI_COLORS,
  MOCHI_SCALES,
  REMINDER_LEADS_MIN,
  ROUTINE_EVENING_HOURS,
  THEMES,
  type ThemePreference,
  SHORTCUT_PRESETS,
  type MochiColor,
  type Settings,
} from '../../../shared/settings';
import { configureSound, playSound } from '../audio/soundEngine';
import { useCalendar } from '../calendar/useCalendar';
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

const THEME_LABEL: Record<ThemePreference, string> = { auto: 'Automático', light: 'Claro', dark: 'Escuro' };

const percent = (v: number) => `${Math.round(v * 100)}%`;

const shortcutLabel = (accelerator: string) =>
  accelerator.replace('Control', 'Ctrl').replace('Space', 'Espaço').replaceAll('+', ' + ');

const hideLabel = (seconds: number) => (seconds === 0 ? 'Nunca (a ilha fica sempre à vista)' : `${seconds} segundos`);

interface SettingsViewProps {
  onBack: () => void;
}

/** Campo de minutos inteiros: só grava quando o valor digitado é válido (senão volta ao salvo ao sair). */
function MinutesField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const parsed = /^\d{1,3}$/.test(text) ? Number(text) : NaN;
  const valid = Number.isInteger(parsed) && parsed >= min && parsed <= max;
  return (
    <label className="settings-minutes-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={text}
        aria-label={`${label} (minutos, de ${min} a ${max})`}
        aria-invalid={valid ? undefined : true}
        onChange={(e) => {
          setText(e.target.value);
          const n = /^\d{1,3}$/.test(e.target.value) ? Number(e.target.value) : NaN;
          if (Number.isInteger(n) && n >= min && n <= max) onCommit(n);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

const syncTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Google Agenda por endereço iCal (somente leitura). O endereço é um segredo: nunca é exibido de volta. */
function CalendarSettings() {
  const { state, busy, setUrl, clear, refresh } = useCalendar();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const connect = async () => {
    setMessage(null);
    const result = await setUrl(text);
    if (result.ok) setText('');
    else setMessage(result.message);
  };

  return (
    <fieldset className="settings-group">
      <legend>Google Agenda</legend>
      {state.configured ? (
        <>
          <p className="settings-hint" data-tone={state.error ? 'warn' : 'ok'} role="status">
            {state.error
              ? state.error
              : `Conectada (${state.host ?? 'agenda'})${state.lastSync ? ` · atualizada às ${syncTime.format(new Date(state.lastSync))}` : ''}.`}
          </p>
          <div className="settings-inline">
            <button type="button" className="settings-small" disabled={busy} onClick={() => void refresh()}>
              {busy ? 'Atualizando…' : 'Atualizar agora'}
            </button>
            <button type="button" className="settings-small" disabled={busy} onClick={() => void clear()}>
              Remover agenda
            </button>
          </div>
          <p className="settings-hint">Só leitura: o Mochi mostra os eventos de hoje nas tarefas e avisa antes.</p>
        </>
      ) : (
        <>
          <label className="settings-stack">
            <span>Endereço secreto no formato iCal</span>
            <input
              type="password"
              className="settings-text"
              value={text}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
              autoComplete="off"
              spellCheck={false}
              disabled={!state.canStore || busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim() !== '') void connect();
              }}
            />
          </label>
          <div className="settings-inline">
            <button
              type="button"
              className="settings-small"
              disabled={!state.canStore || busy || text.trim() === ''}
              onClick={() => void connect()}
            >
              {busy ? 'Conectando…' : 'Conectar'}
            </button>
          </div>
          {message && (
            <p className="settings-hint" data-tone="warn" role="alert">
              {message}
            </p>
          )}
          {!state.canStore && (
            <p className="settings-hint" data-tone="warn">
              O cofre de senhas do Windows não está disponível, então o endereço não pode ser guardado.
            </p>
          )}
          <details className="settings-help">
            <summary>Como achar esse endereço</summary>
            <ol>
              <li>No Google Agenda (no computador), abra Configurações.</li>
              <li>Escolha a sua agenda na lista da esquerda.</li>
              <li>Em “Integrar agenda”, copie o “Endereço secreto no formato iCal”.</li>
              <li>Cole aqui. Ele fica guardado criptografado neste computador; qualquer pessoa com esse endereço vê sua agenda, então não o compartilhe.</li>
            </ol>
          </details>
        </>
      )}
    </fieldset>
  );
}

/** Tela de configurações (no painel). Cada mudança vale na hora e é salva pelo processo principal. */
export function SettingsView({ onBack }: SettingsViewProps) {
  const { settings, packaged, shortcutActive, effective, update } = useSettings();

  // O botão "Ouvir" toca nesta janela: usa os mesmos valores salvos.
  useEffect(() => {
    configureSound({
      enabled: settings.soundEnabled,
      volume: settings.soundVolume,
      profile: characterInfo(settings.character).sound,
    });
  }, [settings.soundEnabled, settings.soundVolume, settings.character]);

  const set = (patch: Partial<Omit<Settings, 'version'>>) => void update(patch);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMessage, setDataMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const runData = async (what: 'export' | 'import') => {
    setDataBusy(true);
    try {
      const r = await (what === 'export' ? window.mochi.data.export() : window.mochi.data.import());
      setDataMessage({ ok: r.ok, text: r.message });
    } finally {
      setDataBusy(false);
    }
  };
  const [modelDraft, setModelDraft] = useState(settings.assistantModel);
  useEffect(() => setModelDraft(settings.assistantModel), [settings.assistantModel]);
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
      character: DEFAULT_SETTINGS.character,
      color: DEFAULT_SETTINGS.color,
      theme: DEFAULT_SETTINGS.theme,
      focusMinutes: DEFAULT_SETTINGS.focusMinutes,
      breakMinutes: DEFAULT_SETTINGS.breakMinutes,
      longBreakMinutes: DEFAULT_SETTINGS.longBreakMinutes,
      pomodoroCycle: DEFAULT_SETTINGS.pomodoroCycle,
      pomodoroAuto: DEFAULT_SETTINGS.pomodoroAuto,
      remindersEnabled: DEFAULT_SETTINGS.remindersEnabled,
      assistantWeb: DEFAULT_SETTINGS.assistantWeb,
      assistantLocalAi: DEFAULT_SETTINGS.assistantLocalAi,
      assistantModel: DEFAULT_SETTINGS.assistantModel,
      routineMorning: DEFAULT_SETTINGS.routineMorning,
      routineEvening: DEFAULT_SETTINGS.routineEvening,
      routineEveningHour: DEFAULT_SETTINGS.routineEveningHour,
      reminderLeadMin: DEFAULT_SETTINGS.reminderLeadMin,
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
        <legend>Aparência do painel</legend>
        <div className="settings-chips" role="radiogroup" aria-label="Tema do painel">
          {THEMES.map((th) => (
            <button
              key={th}
              type="button"
              role="radio"
              aria-checked={settings.theme === th}
              className="settings-chip settings-chip-wide"
              onClick={() => set({ theme: th })}
            >
              {THEME_LABEL[th]}
            </button>
          ))}
        </div>
        <p className="settings-hint">Automático segue o tema do Windows. A ilha é sempre escura.</p>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Personagem</legend>
        <div className="settings-characters" role="radiogroup" aria-label="Personagem">
          {CHARACTERS.map((id) => {
            const info = characterInfo(id);
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.character === id}
                aria-label={info.label}
                title={`${info.label}: ${info.tagline}`}
                className="settings-character"
                data-character-id={id}
                onClick={() => set({ character: id })}
              >
                <span className="settings-character-preview">
                  <Mascot state="idle" replay={0} hop={false} blinking={false} mood="mid" character={id} palette={settings.color} uid={`pv-${id}`} />
                </span>
                <span>{info.label}</span>
              </button>
            );
          })}
        </div>
        <p className="settings-hint">
          {characterInfo(settings.character).tagline}. A troca vale na hora, com o mesmo som e as mesmas
          animações.
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
        <p className="settings-hint">
          {settings.character === 'mochi'
            ? 'A cor vale na hora.'
            : 'A cor vale para o Mochi original; os outros personagens têm as próprias cores.'}
        </p>
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
        <legend>Rotina do dia</legend>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.routineMorning}
            onChange={(e) => set({ routineMorning: e.target.checked })}
          />
          <span>
            Resumo da manhã
            <small>No primeiro uso do dia: tarefas, atrasadas e eventos de hoje.</small>
          </span>
        </label>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.routineEvening}
            onChange={(e) => set({ routineEvening: e.target.checked })}
          />
          <span>
            Fechamento do dia
            <small>O que você concluiu, o foco e o que ficou pendente.</small>
          </span>
        </label>
        <label className="settings-row">
          <span>Fechar o dia às</span>
          <select
            value={settings.routineEveningHour}
            disabled={!settings.routineEvening}
            onChange={(e) => set({ routineEveningHour: Number(e.target.value) })}
          >
            {ROUTINE_EVENING_HOURS.map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Assistente</legend>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.assistantWeb}
            onChange={(e) => set({ assistantWeb: e.target.checked })}
          />
          <span>
            Pesquisar na Wikipédia quando eu perguntar algo
            <small>Usa a internet (só o texto da pergunta é enviado). Desligado por padrão.</small>
          </span>
        </label>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.assistantLocalAi}
            onChange={(e) => set({ assistantLocalAi: e.target.checked })}
          />
          <span>
            Conversar com uma IA local (Ollama)
            <small>Grátis e privada: roda no seu computador, sem tokens. Precisa do Ollama instalado.</small>
          </span>
        </label>
        <label className="settings-row">
          <span>Modelo da IA local</span>
          <input
            className="settings-text"
            type="text"
            value={modelDraft}
            maxLength={70}
            spellCheck={false}
            aria-invalid={!MODEL_NAME_RE.test(modelDraft)}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => {
              if (MODEL_NAME_RE.test(modelDraft)) set({ assistantModel: modelDraft });
              else setModelDraft(settings.assistantModel);
            }}
          />
        </label>
        <p className="settings-hint">
          O microfone usa o reconhecimento de fala do Windows (Configurações &gt; Privacidade &gt; Fala).
        </p>
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
        <legend>Modo foco</legend>
        <div className="settings-row">
          <span>Duração padrão</span>
          <span className="settings-minutes">
            <MinutesField label="Foco" value={settings.focusMinutes} min={1} max={180} onCommit={(v) => set({ focusMinutes: v })} />
            <MinutesField label="Pausa" value={settings.breakMinutes} min={1} max={60} onCommit={(v) => set({ breakMinutes: v })} />
            <MinutesField
              label="Longa"
              value={settings.longBreakMinutes}
              min={1}
              max={60}
              onCommit={(v) => set({ longBreakMinutes: v })}
            />
          </span>
        </div>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.pomodoroCycle}
            onChange={(e) => set({ pomodoroCycle: e.target.checked })}
          />
          <span>
            Ciclo Pomodoro
            <small>Pausa longa a cada 4 focos concluídos.</small>
          </span>
        </label>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.pomodoroAuto}
            disabled={!settings.pomodoroCycle}
            onChange={(e) => set({ pomodoroAuto: e.target.checked })}
          />
          <span>
            Iniciar a próxima etapa sozinho
            <small>Senão o Mochi espera você confirmar.</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="settings-group">
        <legend>Lembretes de tarefas</legend>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.remindersEnabled}
            onChange={(e) => set({ remindersEnabled: e.target.checked })}
          />
          <span>
            Avisar quando uma tarefa com prazo chegar
            <small>Balão e som; notificação se o Mochi estiver oculto.</small>
          </span>
        </label>
        <label className="settings-row">
          <span>Avisar também antes</span>
          <select
            value={settings.reminderLeadMin}
            disabled={!settings.remindersEnabled}
            onChange={(e) => set({ reminderLeadMin: Number(e.target.value) })}
          >
            {REMINDER_LEADS_MIN.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'Só na hora marcada' : `${m} minutos antes`}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <CalendarSettings />

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

      <fieldset className="settings-group">
        <legend>Seus dados</legend>
        <div className="settings-chips">
          <button type="button" className="settings-small" disabled={dataBusy} onClick={() => void runData('export')}>
            Exportar tarefas e notas…
          </button>
          <button type="button" className="settings-small" disabled={dataBusy} onClick={() => void runData('import')}>
            Importar de um backup…
          </button>
        </div>
        <p className="settings-hint" role="status" data-tone={dataMessage?.ok ? 'ok' : undefined}>
          {dataMessage?.text ?? 'Gera um arquivo JSON. Ao importar, nada é sobrescrito: só o que falta é adicionado.'}
        </p>
      </fieldset>

      <div className="settings-footer">
        <button type="button" className="settings-small" onClick={resetAll}>
          Restaurar padrões
        </button>
      </div>
    </section>
  );
}
