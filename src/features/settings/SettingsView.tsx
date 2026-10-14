import { useEffect, useState } from 'react';
import { Mascot } from '../mascot/Mascot';
import { characterInfo } from '../mascot/characters';
import {
  ASSISTANT_SHORTCUT_PRESETS,
  GEMINI_MODEL_RE,
  GEMINI_MODEL_SUGGESTIONS,
  PERSONA_NOTES_LIMIT,
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
import { WELLNESS_INTERVALS, WELLNESS_LABEL } from '../../../shared/wellness';
import type { GeminiStatus } from '../../../shared/assistantApi';
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
function CalendarSettings({ hidden }: { hidden: boolean }) {
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
    <fieldset className="settings-group" hidden={hidden}>
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
          <p className="settings-hint">Só leitura: o Nimboo mostra os eventos de hoje nas tarefas e avisa antes.</p>
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
type SettingsTab = 'appearance' | 'behavior' | 'assistant' | 'focus' | 'general';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: 'Aparência' },
  { id: 'behavior', label: 'Comportamento' },
  { id: 'assistant', label: 'Assistente' },
  { id: 'focus', label: 'Foco e agenda' },
  { id: 'general', label: 'Geral' },
];

const TAB_KEY = 'nimboo.settings.tab';

function initialTab(): SettingsTab {
  try {
    const saved = window.sessionStorage.getItem(TAB_KEY);
    if (SETTINGS_TABS.some((s) => s.id === saved)) return saved as SettingsTab;
  } catch {
    /* sem armazenamento: começa na primeira */
  }
  return 'appearance';
}

const WELLNESS_ROWS = [
  { kind: 'water', on: 'wellnessWater', min: 'wellnessWaterMin' },
  { kind: 'posture', on: 'wellnessPosture', min: 'wellnessPostureMin' },
  { kind: 'eyes', on: 'wellnessEyes', min: 'wellnessEyesMin' },
] as const;

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
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const selectTab = (next: SettingsTab) => {
    setTab(next);
    try {
      window.sessionStorage.setItem(TAB_KEY, next);
    } catch {
      /* ignora */
    }
  };
  const [gem, setGem] = useState<GeminiStatus>({ hasKey: false, encryptionAvailable: true });
  const [keyDraft, setKeyDraft] = useState('');
  const [gemMsg, setGemMsg] = useState<string | null>(null);
  const [geminiConsent, setGeminiConsent] = useState(false);
  const [geminiModelDraft, setGeminiModelDraft] = useState(settings.geminiModel);
  useEffect(() => setGeminiModelDraft(settings.geminiModel), [settings.geminiModel]);
  const [personaDraft, setPersonaDraft] = useState(settings.assistantPersona);
  useEffect(() => setPersonaDraft(settings.assistantPersona), [settings.assistantPersona]);
  useEffect(() => {
    void window.mochi.assistant.gemini.status().then(setGem).catch(() => undefined);
  }, []);
  const [nameDraft, setNameDraft] = useState(settings.mascotName);
  useEffect(() => setNameDraft(settings.mascotName), [settings.mascotName]);
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
      wellnessWater: DEFAULT_SETTINGS.wellnessWater,
      wellnessWaterMin: DEFAULT_SETTINGS.wellnessWaterMin,
      wellnessPosture: DEFAULT_SETTINGS.wellnessPosture,
      wellnessPostureMin: DEFAULT_SETTINGS.wellnessPostureMin,
      wellnessEyes: DEFAULT_SETTINGS.wellnessEyes,
      wellnessEyesMin: DEFAULT_SETTINGS.wellnessEyesMin,
      wellnessStretch: DEFAULT_SETTINGS.wellnessStretch,
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

      <div className="settings-tabs" role="tablist" aria-label="Seções das configurações">
        {SETTINGS_TABS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            id={`settings-tab-${s.id}`}
            aria-selected={tab === s.id}
            className="settings-tab"
            data-testid={`settings-tab-${s.id}`}
            onClick={() => selectTab(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <fieldset className="settings-group" hidden={tab !== 'appearance'}>
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

      <fieldset className="settings-group" hidden={tab !== 'appearance'}>
        <legend>Tamanho do Nimboo solto</legend>
        <div className="settings-chips" role="radiogroup" aria-label="Tamanho do Nimboo solto">
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
            'No modo flutuante e quando o Nimboo aparece no canto da tela.'}
        </p>
      </fieldset>

      <fieldset className="settings-group" hidden={tab !== 'appearance'}>
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

      <fieldset className="settings-group" hidden={tab !== 'appearance'}>
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
        <label className="settings-row">
          <span>Nome do seu personagem</span>
          <input
            className="settings-text"
            type="text"
            data-testid="mascot-name"
            value={nameDraft}
            maxLength={20}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              const name = nameDraft.replace(/\s+/g, ' ').trim();
              if (name && name !== settings.mascotName) set({ mascotName: name });
              else setNameDraft(settings.mascotName);
            }}
          />
        </label>
        <button type="button" className="settings-small" onClick={() => window.mochi.bond.open()}>
          Ver conquistas
        </button>
      </fieldset>

      <fieldset className="settings-group" hidden={tab !== 'appearance'}>
        <legend>Cor do Nimboo</legend>
        <div className="settings-swatches" role="radiogroup" aria-label="Cor do Nimboo">
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
            : 'A cor vale para o Nimboo original; os outros personagens têm as próprias cores.'}
        </p>
      </fieldset>

      <fieldset className="settings-group" hidden={tab !== 'behavior'}>
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
            <small>O Nimboo comenta de vez em quando; fica quieto durante o foco.</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="settings-group" hidden={tab !== 'behavior'}>
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

      <fieldset className="settings-group" hidden={tab !== 'behavior'}>
        <legend>Bem-estar</legend>
        {WELLNESS_ROWS.map((row) => (
          <div className="settings-row settings-wellness" key={row.kind}>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={settings[row.on]}
                onChange={(e) => set({ [row.on]: e.target.checked })}
              />
              <span>{WELLNESS_LABEL[row.kind]}</span>
            </label>
            <select
              aria-label={`Intervalo: ${WELLNESS_LABEL[row.kind]}`}
              value={settings[row.min]}
              disabled={!settings[row.on]}
              onChange={(e) => set({ [row.min]: Number(e.target.value) })}
            >
              {WELLNESS_INTERVALS[row.kind].map((m) => (
                <option key={m} value={m}>
                  a cada {m} min
                </option>
              ))}
            </select>
          </div>
        ))}
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.wellnessStretch}
            onChange={(e) => set({ wellnessStretch: e.target.checked })}
          />
          <span>
            Alongar depois do foco
            <small>Ao terminar uma sessão, o Nimboo sugere levantar um pouco.</small>
          </span>
        </label>
        <p className="settings-hint">
          Tudo começa desligado. Os lembretes usam os balões de fala e ficam quietos durante o foco.
        </p>
      </fieldset>

      <fieldset className="settings-group" hidden={tab !== 'assistant'}>
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
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.assistantHistory}
            onChange={(e) => set({ assistantHistory: e.target.checked })}
          />
          <span>
            Guardar o histórico da conversa
            <small>Só neste computador, até 200 mensagens. Aparece na janela do assistente e dá para apagar.</small>
          </span>
        </label>
        <div className="settings-row">
          <span>Atalho para falar com o assistente</span>
          <select
            aria-label="Atalho para falar com o assistente"
            data-testid="assistant-shortcut"
            value={settings.assistantShortcut ?? ''}
            onChange={(e) => set({ assistantShortcut: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">Desligado</option>
            {ASSISTANT_SHORTCUT_PRESETS.map((s) => (
              <option key={s} value={s}>
                {s.replace('Control', 'Ctrl')}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="settings-small" onClick={() => void window.mochi.assistant.history.clear()}>
          Apagar histórico agora
        </button>
        <p className="settings-hint">
          O microfone usa o reconhecimento de fala do Windows (Configurações &gt; Privacidade &gt; Fala). O atalho
          abre o assistente já ouvindo.
        </p>
      </fieldset>
      <fieldset className="settings-group" data-testid="gemini-group" hidden={tab !== 'assistant'}>
        <legend>IA online (Gemini)</legend>
        <p className="settings-hint">
          Conversa de verdade, com a personalidade do seu personagem, usando o Gemini do Google com a sua própria
          chave (existe plano gratuito, com limites). <strong>O texto das suas mensagens é enviado ao Google</strong>
          {settings.assistantContext ? ', junto com os títulos das tarefas e da agenda de hoje' : ''}. Confira os
          termos do plano gratuito do Google: nele, o conteúdo pode ser usado para melhorar os serviços deles.
        </p>
        <ol className="settings-steps">
          <li>
            Abra a página de chaves do Google AI Studio{' '}
            <button type="button" className="settings-small" onClick={() => window.mochi.assistant.gemini.openKeyPage()}>
              Abrir página
            </button>
          </li>
          <li>Entre com sua conta Google e clique em “Criar chave de API”.</li>
          <li>Copie a chave, cole abaixo e clique em “Guardar chave”.</li>
        </ol>
        <div className="settings-row">
          <span>Chave da API</span>
          <input
            className="settings-text"
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-testid="gemini-key"
            placeholder={gem.hasKey ? '•••••••• (guardada)' : 'Cole a chave aqui'}
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
        </div>
        <div className="settings-row settings-buttons">
          <button
            type="button"
            className="settings-small"
            data-testid="gemini-save"
            disabled={keyDraft.trim() === ''}
            onClick={async () => {
              const r = await window.mochi.assistant.gemini.setKey(keyDraft);
              setGemMsg(
                r.ok && !settings.assistantGemini
                  ? `${r.message} Agora clique em “Testar conexão”, marque o aviso e ative “Usar o Gemini nas conversas”.`
                  : r.message,
              );
              if (r.ok) setKeyDraft('');
              setGem(await window.mochi.assistant.gemini.status());
            }}
          >
            Guardar chave
          </button>
          <button
            type="button"
            className="settings-small"
            disabled={!gem.hasKey}
            data-testid="gemini-test"
            onClick={async () => {
              setGemMsg('Testando…');
              const r = await window.mochi.assistant.gemini.test();
              setGemMsg(r.message);
              if (r.ok && r.model && r.model !== settings.geminiModel) await update({ geminiModel: r.model });
            }}
          >
            Testar conexão
          </button>
          <button
            type="button"
            className="settings-small"
            disabled={!gem.hasKey}
            data-testid="gemini-remove"
            onClick={async () => {
              await window.mochi.assistant.gemini.clearKey();
              await update({ assistantGemini: false });
              setGem(await window.mochi.assistant.gemini.status());
              setGemMsg('Chave removida.');
            }}
          >
            Remover chave
          </button>
        </div>
        <p className="settings-hint" role="status" data-testid="gemini-status">
          {gemMsg ??
            (gem.hasKey
              ? 'Chave guardada com segurança (cifrada pelo Windows).'
              : gem.encryptionAvailable
                ? 'Nenhuma chave guardada.'
                : 'Este computador não permite guardar a chave com segurança.')}
        </p>
        {!settings.assistantGemini && (
          <label className="settings-row settings-check">
            <input
              type="checkbox"
              data-testid="gemini-consent"
              checked={geminiConsent}
              onChange={(e) => setGeminiConsent(e.target.checked)}
            />
            <span>Entendi que as mensagens vão para o Google para gerar as respostas.</span>
          </label>
        )}
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            data-testid="gemini-enable"
            checked={settings.assistantGemini}
            disabled={!gem.hasKey || (!settings.assistantGemini && !geminiConsent)}
            onChange={(e) => set({ assistantGemini: e.target.checked })}
          />
          <span>
            Usar o Gemini nas conversas
            <small>O que os comandos locais não entendem vai para o Gemini. Tarefas e notas continuam locais.</small>
          </span>
        </label>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.assistantContext}
            disabled={!settings.assistantGemini}
            onChange={(e) => set({ assistantContext: e.target.checked })}
          />
          <span>
            Deixar o Gemini ver minhas tarefas e agenda de hoje
            <small>Só os títulos (e prazos) vão junto de cada mensagem. Desligado por padrão.</small>
          </span>
        </label>
        <label className="settings-row">
          <span>Modelo</span>
          <input
            className="settings-text"
            type="text"
            list="gemini-models"
            spellCheck={false}
            value={geminiModelDraft}
            aria-invalid={!GEMINI_MODEL_RE.test(geminiModelDraft)}
            onChange={(e) => setGeminiModelDraft(e.target.value)}
            onBlur={() => {
              if (GEMINI_MODEL_RE.test(geminiModelDraft)) set({ geminiModel: geminiModelDraft });
              else setGeminiModelDraft(settings.geminiModel);
            }}
          />
          <datalist id="gemini-models">
            {GEMINI_MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="settings-row settings-column">
          <span>
            Jeito do personagem (opcional)
            <small>Ex.: “fale de forma mais objetiva” ou “me chame de Gu”. Até {PERSONA_NOTES_LIMIT} caracteres.</small>
          </span>
          <textarea
            className="settings-text"
            rows={3}
            maxLength={PERSONA_NOTES_LIMIT}
            data-testid="gemini-persona"
            value={personaDraft}
            onChange={(e) => setPersonaDraft(e.target.value)}
            onBlur={() => {
              if (personaDraft !== settings.assistantPersona) set({ assistantPersona: personaDraft });
            }}
          />
        </label>
      </fieldset>

      <fieldset className="settings-group" hidden={tab !== 'behavior'}>
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

      <fieldset className="settings-group" hidden={tab !== 'focus'}>
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
            <small>Senão o Nimboo espera você confirmar.</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="settings-group" hidden={tab !== 'focus'}>
        <legend>Lembretes de tarefas</legend>
        <label className="settings-row settings-check">
          <input
            type="checkbox"
            checked={settings.remindersEnabled}
            onChange={(e) => set({ remindersEnabled: e.target.checked })}
          />
          <span>
            Avisar quando uma tarefa com prazo chegar
            <small>Balão e som; notificação se o Nimboo estiver oculto.</small>
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

      <CalendarSettings hidden={tab !== 'focus'} />

      <fieldset className="settings-group" hidden={tab !== 'general'}>
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
                ? 'Abre o Nimboo quando você entrar no computador.'
                : 'Disponível quando o Nimboo estiver instalado (esta é a versão de desenvolvimento).'}
            </small>
          </span>
        </label>
      </fieldset>

      <fieldset className="settings-group" hidden={tab !== 'general'}>
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

      <div className="settings-footer" hidden={tab !== 'general'}>
        <button type="button" className="settings-small" onClick={resetAll}>
          Restaurar padrões
        </button>
      </div>
    </section>
  );
}
