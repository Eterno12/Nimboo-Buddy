import {
  AFFECTION_ANNOYED_PENALTY,
  AFFECTION_DECAY,
  AFFECTION_DECAY_MS,
  AFFECTION_PER_PET,
  AFFECTION_START,
  AMBIENT_MAX_MS,
  AMBIENT_MIN_MS,
  ANNOYED_CLICKS,
  ANNOYED_WINDOW_MS,
  BLINK_DURATION_MS,
  BLINK_MAX_MS,
  BLINK_MIN_MS,
  CALM_STATES,
  GIGGLE_CLICKS,
  GIGGLE_WINDOW_MS,
  MOOD_HIGH_ABOVE,
  MOOD_LOW_BELOW,
  NEAR_ENTER_PX,
  NEAR_LEAVE_PX,
  SLEEP_AFTER_MS,
  SLEEP_RETRY_MS,
  STARTLE_COOLDOWN_MS,
  STARTLE_DISTANCE_PX,
  STARTLE_SPEED_PX_S,
  STATE_DURATION_MS,
  STATE_PRIORITY,
  WAKE_DISTANCE_PX,
  type MascotState,
  type Mood,
} from './mascotStates.ts';
import type { CharacterTraits } from './characters.ts';

const NEUTRAL: CharacterTraits = { ambientPace: 1, sleepAfter: 1, blinkPace: 1, curiosity: 0 };

export interface MascotSnapshot {
  state: MascotState;
  /** Incrementa quando o mesmo estado é disparado de novo (reinicia a animação). */
  replay: number;
  /** Pequeno salto; só tem efeito visual em idle/curious. */
  hop: boolean;
  blinking: boolean;
  mood: Mood;
}

/** Medida do cursor em relação ao corpo do mascote (calculada pela view). */
export interface CursorSample {
  /** Distância do centro do corpo, em px. */
  distance: number;
  /** Velocidade do cursor, em px/s. */
  speed: number;
  /** O cursor está se aproximando do corpo. */
  approaching: boolean;
}

export interface MascotController {
  start(): void;
  dispose(): void;
  /** Clique/carinho (clique sem arrastar). */
  pet(): void;
  /** Usado futuramente quando uma tarefa for concluída. */
  celebrate(): void;
  /** Cumprimento ao chegar em cena (sem alterar o afeto). */
  greet(): void;
  hoverChange(hovering: boolean): void;
  /** Cursor em qualquer lugar da tela. */
  cursor(sample: CursorSample): void;
  /** Qualquer interação do usuário: acorda e reinicia o contador de sono. */
  activity(): void;
  /** O usuário começou a arrastar o mascote. */
  grab(): void;
  /** O usuário soltou o mascote. */
  release(): void;
  endHop(): void;
  /** Força um estado (apenas para depuração). */
  debugSet(state: MascotState): void;
  /** Troca a personalidade (ritmos) do personagem; vale a partir do próximo temporizador. */
  setTraits(traits: CharacterTraits): void;
  /** Volta ao afeto guardado de outra sessão (o humor persiste entre aberturas do app). */
  restoreAffection(value: number): void;
  getAffection(): number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const moodOf = (affection: number): Mood =>
  affection < MOOD_LOW_BELOW ? 'low' : affection > MOOD_HIGH_ABOVE ? 'high' : 'mid';

/**
 * Máquina de estados do mascote, sem dependência de React.
 * Toda mudança de expressão passa por `enter`, então só um estado controla a
 * aparência por vez.
 */
export function createMascotController(onChange: (s: MascotSnapshot) => void): MascotController {
  let snap: MascotSnapshot = { state: 'idle', replay: 0, hop: false, blinking: false, mood: 'mid' };
  let hovering = false;
  let proximityNear = false;
  let affection = AFFECTION_START;
  let lastStartle = 0;
  let clicks: number[] = [];
  let traits: CharacterTraits = NEUTRAL;
  const timers: Record<'timed' | 'sleep' | 'ambient' | 'blink' | 'blinkEnd' | 'mood', number | undefined> = {
    timed: undefined,
    sleep: undefined,
    ambient: undefined,
    blink: undefined,
    blinkEnd: undefined,
    mood: undefined,
  };

  const emit = (patch: Partial<MascotSnapshot>) => {
    snap = { ...snap, ...patch };
    onChange(snap);
  };

  const isNear = () => hovering || proximityNear;
  const rest = (): MascotState => (isNear() ? 'curious' : 'idle');

  function setAffection(value: number) {
    affection = Math.max(0, Math.min(1, value));
    const mood = moodOf(affection);
    if (mood !== snap.mood) emit({ mood });
  }

  function armSleep(ms = SLEEP_AFTER_MS * traits.sleepAfter) {
    window.clearTimeout(timers.sleep);
    timers.sleep = window.setTimeout(() => {
      // Boceja antes de dormir. Se estiver no meio de algo (curioso, feliz...), tenta de novo logo.
      if (snap.state === 'idle') enter('yawn', true, 'sleepy');
      else if (snap.state !== 'sleepy') armSleep(SLEEP_RETRY_MS);
    }, ms);
  }

  /**
   * ambient: comportamento espontâneo (olhar em volta, espreguiçar). Esses NÃO reiniciam o
   * contador de sono: sem isso, as animações de fundo (a cada ~12 s) o impediam de dormir.
   */
  function enter(next: MascotState, force = false, after?: MascotState, ambient = false) {
    if (!force && STATE_PRIORITY[next] < STATE_PRIORITY[snap.state]) return;
    window.clearTimeout(timers.timed);
    emit({
      state: next,
      replay: next === snap.state ? snap.replay + 1 : snap.replay,
      hop: false,
      blinking: false,
    });
    const duration = STATE_DURATION_MS[next];
    if (duration) timers.timed = window.setTimeout(() => enter(after ?? rest(), true, undefined, ambient), duration);
    if (!ambient) armSleep();
  }

  /** Acorda espreguiçando. */
  function wake() {
    enter('stretch', true);
  }

  function refreshNear() {
    if (isNear()) {
      if (snap.state === 'idle' || snap.state === 'lookaround') enter('curious', true);
    } else if (snap.state === 'curious') {
      enter('idle', true);
    }
  }

  function scheduleBlink() {
    timers.blink = window.setTimeout(() => {
      if (snap.state === 'idle' || snap.state === 'curious' || snap.state === 'lookaround') {
        emit({ blinking: true });
        timers.blinkEnd = window.setTimeout(() => emit({ blinking: false }), BLINK_DURATION_MS);
      }
      scheduleBlink();
    }, rand(BLINK_MIN_MS, BLINK_MAX_MS) * traits.blinkPace);
  }

  /** Comportamentos espontâneos; humor alto é mais animado, humor baixo é mais quieto. */
  function scheduleAmbient() {
    const pace = (snap.mood === 'high' ? 0.75 : snap.mood === 'low' ? 1.7 : 1) * traits.ambientPace;
    timers.ambient = window.setTimeout(() => {
      if (snap.state === 'idle') {
        // A curiosidade do personagem troca um pouco de pulinho/espreguiçada por "olhar em volta".
        const c = traits.curiosity;
        const hop = 0.35 - c / 2;
        const look = hop + 0.3 + c;
        const stretch = look + 0.2 - c / 2;
        const r = Math.random();
        if (r < hop) emit({ hop: true });
        else if (r < look) enter('lookaround', false, undefined, true);
        else if (r < stretch) enter('stretch', false, undefined, true);
        else enter('yawn', false, undefined, true);
      }
      scheduleAmbient();
    }, rand(AMBIENT_MIN_MS, AMBIENT_MAX_MS) * pace);
  }

  return {
    start() {
      scheduleBlink();
      scheduleAmbient();
      armSleep();
      timers.mood = window.setInterval(() => setAffection(affection - AFFECTION_DECAY), AFFECTION_DECAY_MS);
    },
    dispose() {
      Object.values(timers).forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
    },
    pet() {
      // Emburrado: continuar clicando só prolonga o mau humor.
      if (snap.state === 'annoyed') {
        setAffection(affection - AFFECTION_ANNOYED_PENALTY);
        enter('annoyed');
        return;
      }
      const now = Date.now();
      clicks = clicks.filter((t) => now - t < ANNOYED_WINDOW_MS);
      clicks.push(now);
      setAffection(affection + AFFECTION_PER_PET);
      const recent = clicks.filter((t) => now - t < GIGGLE_WINDOW_MS).length;
      if (clicks.length >= ANNOYED_CLICKS) {
        clicks = [];
        setAffection(affection - AFFECTION_ANNOYED_PENALTY);
        enter('annoyed');
      } else if (recent >= GIGGLE_CLICKS) {
        enter('giggle');
      } else {
        enter('happy');
      }
    },
    celebrate: () => enter('celebrate'),
    greet: () => enter('happy'),
    hoverChange(next) {
      hovering = next;
      if (next && snap.state === 'sleepy') wake();
      else refreshNear();
      if (!next) armSleep();
    },
    cursor({ distance, speed, approaching }) {
      const wasNear = proximityNear;
      proximityNear = proximityNear ? distance <= NEAR_LEAVE_PX : distance < NEAR_ENTER_PX;
      if (proximityNear !== wasNear) refreshNear();

      if (snap.state === 'sleepy' && distance < WAKE_DISTANCE_PX) wake();

      const now = Date.now();
      const startleable = snap.state === 'sleepy' || snap.state === 'curious' || CALM_STATES.includes(snap.state);
      if (
        startleable &&
        approaching &&
        speed > STARTLE_SPEED_PX_S &&
        distance < STARTLE_DISTANCE_PX &&
        now - lastStartle > STARTLE_COOLDOWN_MS
      ) {
        lastStartle = now;
        enter('surprised', true);
      }
    },
    activity() {
      if (snap.state === 'sleepy') wake();
      else armSleep();
    },
    grab: () => enter('grabbed', true),
    release() {
      if (snap.state !== 'grabbed') return;
      enter(rest(), true);
      emit({ hop: true });
    },
    endHop() {
      if (snap.hop) emit({ hop: false });
    },
    debugSet: (state) => enter(state, true),
    restoreAffection: (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) setAffection(value);
    },
    getAffection: () => affection,
    setTraits(next) {
      traits = next;
      // O contador de sono já armado usa o ritmo anterior: rearma só se estiver em repouso.
      if (snap.state === 'idle' || snap.state === 'curious') armSleep();
    },
  };
}
