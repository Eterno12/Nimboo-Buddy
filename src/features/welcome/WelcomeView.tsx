import { useCallback, useEffect, useState } from 'react';
import { CHARACTERS } from '../../../shared/settings';
import { Mascot } from '../mascot/Mascot';
import { characterInfo } from '../mascot/characters';
import type { MascotState } from '../mascot/mascotStates';
import { useSettings } from '../settings/useSettings';
import { useTheme } from '../settings/useTheme';
import './welcome.css';

const STEPS = ['hello', 'character', 'name', 'features', 'done'] as const;
type Step = (typeof STEPS)[number];

/** Reação do Nimboo a cada passo (as mesmas animações do app, nada novo). */
const FACE: Record<Step, MascotState> = {
  hello: 'happy',
  character: 'curious',
  name: 'happy',
  features: 'lookaround',
  done: 'celebrate',
};

const CONFETTI = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 6) * 0.12,
  hue: (i * 47) % 360,
  drift: ((i * 29) % 60) - 30,
}));

/** Primeira execução guiada: boas-vindas, personagem, nome, recursos e dicas. Tudo opcional e reversível. */
export function WelcomeView() {
  const { settings, update } = useSettings();
  const theme = useTheme(settings.theme);
  const [index, setIndex] = useState(0);
  const [replay, setReplay] = useState(0);
  const [nameDraft, setNameDraft] = useState(settings.mascotName);
  const step = STEPS[index];
  const info = characterInfo(settings.character);

  useEffect(() => setNameDraft(settings.mascotName), [settings.mascotName]);
  useEffect(() => setReplay((r) => r + 1), [index]);

  const finish = useCallback(async () => {
    await update({ onboardingDone: true });
    window.close();
  }, [update]);

  const commitName = () => {
    const name = nameDraft.replace(/\s+/g, ' ').trim();
    if (name && name !== settings.mascotName) void update({ mascotName: name });
    else setNameDraft(settings.mascotName);
  };

  const next = () => {
    if (step === 'name') commitName();
    setIndex((i) => Math.min(STEPS.length - 1, i + 1));
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));

  const wellnessOn = settings.wellnessWater || settings.wellnessPosture || settings.wellnessEyes;

  return (
    <main className="welcome" data-theme={theme} data-step={step}>
      <header className="welcome-top">
        <div className="welcome-mascot" aria-hidden="true">
          <Mascot
            state={FACE[step]}
            replay={replay}
            hop={false}
            blinking={false}
            mood="high"
            character={settings.character}
            palette={settings.color}
            uid="welcome"
          />
        </div>
        <ol className="welcome-dots" aria-label={`Passo ${index + 1} de ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <li key={s} data-state={i === index ? 'now' : i < index ? 'done' : 'todo'} />
          ))}
        </ol>
        {step === 'done' && (
          <div className="welcome-confetti" aria-hidden="true">
            {CONFETTI.map((c, i) => (
              <span
                key={i}
                style={{
                  left: `${c.left}%`,
                  animationDelay: `${c.delay}s`,
                  background: `hsl(${c.hue} 80% 65%)`,
                  ['--drift' as string]: `${c.drift}px`,
                }}
              />
            ))}
          </div>
        )}
      </header>

      <section className="welcome-body" key={step} aria-live="polite">
        {step === 'hello' && (
          <>
            <h1>Oi! Eu sou o {settings.mascotName}</h1>
            <p>
              Vou morar no topo da sua tela e ajudar com tarefas, notas, foco e agenda, sem atrapalhar. Leva menos de
              um minuto para deixar tudo do seu jeito.
            </p>
          </>
        )}

        {step === 'character' && (
          <>
            <h1>Quem vai te acompanhar?</h1>
            <div className="welcome-characters" role="radiogroup" aria-label="Personagem">
              {CHARACTERS.map((id) => {
                const c = characterInfo(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={settings.character === id}
                    data-testid={`welcome-character-${id}`}
                    onClick={() => {
                      void update({ character: id });
                      setReplay((r) => r + 1);
                    }}
                  >
                    <span className="welcome-char-preview" aria-hidden="true">
                      <Mascot
                        state="idle"
                        replay={0}
                        hop={false}
                        blinking={false}
                        mood="mid"
                        character={id}
                        palette={settings.color}
                        uid={`wc-${id}`}
                      />
                    </span>
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="welcome-hint">{info.tagline}. Dá para trocar depois em Configurações.</p>
          </>
        )}

        {step === 'name' && (
          <>
            <h1>Qual vai ser o nome dele?</h1>
            <label className="welcome-field">
              <span className="sr-only">Nome do personagem</span>
              <input
                type="text"
                data-testid="welcome-name"
                value={nameDraft}
                maxLength={20}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') next();
                }}
              />
            </label>
            <p className="welcome-hint">Ele aparece no assistente e nas conquistas.</p>
          </>
        )}

        {step === 'features' && (
          <>
            <h1>O que você quer ligado?</h1>
            <label className="welcome-toggle">
              <input
                type="checkbox"
                checked={settings.bubbles}
                onChange={(e) => void update({ bubbles: e.target.checked })}
              />
              <span>
                Balões de fala<small>Ele comenta de vez em quando e fica quieto no foco.</small>
              </span>
            </label>
            <label className="welcome-toggle">
              <input
                type="checkbox"
                checked={settings.routineMorning}
                onChange={(e) => void update({ routineMorning: e.target.checked, routineEvening: e.target.checked })}
              />
              <span>
                Resumo do dia<small>Um cartão pela manhã e outro à noite com tarefas e agenda.</small>
              </span>
            </label>
            <label className="welcome-toggle">
              <input
                type="checkbox"
                checked={settings.mediaPlayer}
                onChange={(e) => void update({ mediaPlayer: e.target.checked })}
              />
              <span>
                Player de música<small>Mostra o que toca e deixa pausar ou pular. Tudo local.</small>
              </span>
            </label>
            <label className="welcome-toggle">
              <input
                type="checkbox"
                checked={wellnessOn}
                onChange={(e) =>
                  void update({
                    wellnessWater: e.target.checked,
                    wellnessPosture: e.target.checked,
                    wellnessEyes: e.target.checked,
                  })
                }
              />
              <span>
                Lembretes de bem-estar<small>Água, postura e descanso dos olhos, de tempos em tempos.</small>
              </span>
            </label>
          </>
        )}

        {step === 'done' && (
          <>
            <h1>Tudo pronto!</h1>
            <ul className="welcome-tips">
              <li>
                <b>Clique no {settings.mascotName}</b> no topo da tela para abrir a ilha.
              </li>
              <li>
                Encoste o cursor na <b>borda superior</b> para ele voltar quando estiver escondido.
              </li>
              <li>
                <b>Botão direito</b> ou o ícone da bandeja abre o menu, as configurações e as conquistas.
              </li>
              <li>
                Fale com o <b>Assistente</b>: “crie uma tarefa…”, “o que tenho amanhã?”. A IA online é opcional.
              </li>
            </ul>
          </>
        )}
      </section>

      <footer className="welcome-actions">
        {step === 'done' ? (
          <button type="button" className="welcome-primary" data-testid="welcome-finish" onClick={() => void finish()}>
            Começar
          </button>
        ) : (
          <>
            <button type="button" className="welcome-link" data-testid="welcome-skip" onClick={() => void finish()}>
              Pular
            </button>
            <span className="welcome-spacer" />
            {index > 0 && (
              <button type="button" className="welcome-secondary" onClick={back}>
                Voltar
              </button>
            )}
            <button type="button" className="welcome-primary" data-testid="welcome-next" onClick={next}>
              {step === 'hello' ? 'Vamos lá' : 'Continuar'}
            </button>
          </>
        )}
      </footer>
    </main>
  );
}
