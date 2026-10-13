/** Estados possíveis do mascote. Apenas um está ativo por vez. */
export type MascotState =
  | 'idle'
  | 'happy'
  | 'curious'
  | 'sleepy'
  | 'celebrate'
  | 'surprised'
  | 'grabbed'
  | 'giggle'
  | 'annoyed'
  | 'stretch'
  | 'yawn'
  | 'lookaround';

export const MASCOT_STATES: readonly MascotState[] = [
  'idle',
  'happy',
  'curious',
  'sleepy',
  'celebrate',
  'surprised',
  'grabbed',
  'giggle',
  'annoyed',
  'stretch',
  'yawn',
  'lookaround',
];

/** Humor de longo prazo, derivado do carinho recebido. */
export type Mood = 'low' | 'mid' | 'high';

/** Estados que terminam sozinhos e voltam ao repouso (ms). */
export const STATE_DURATION_MS: Partial<Record<MascotState, number>> = {
  happy: 1600,
  celebrate: 2600,
  surprised: 900,
  giggle: 1400,
  annoyed: 1800,
  stretch: 1500,
  yawn: 2200,
  lookaround: 2400,
};

/** Um estado só interrompe outro de prioridade igual ou menor. */
export const STATE_PRIORITY: Record<MascotState, number> = {
  idle: 0,
  sleepy: 0,
  lookaround: 0,
  stretch: 0,
  yawn: 0,
  curious: 1,
  surprised: 2,
  happy: 2,
  giggle: 3,
  annoyed: 3,
  celebrate: 4,
  grabbed: 5,
};

/** Estados "calmos" nos quais o cursor pode causar susto ou curiosidade. */
export const CALM_STATES: readonly MascotState[] = ['idle', 'lookaround', 'stretch', 'yawn'];

export const SLEEP_AFTER_MS = 45_000;
export const BLINK_MIN_MS = 2500;
export const BLINK_MAX_MS = 6000;
export const BLINK_DURATION_MS = 140;
export const AMBIENT_MIN_MS = 8000;
export const AMBIENT_MAX_MS = 16_000;

/** Distâncias do cursor ao centro do corpo, em pixels da janela. */
export const NEAR_ENTER_PX = 150;
export const NEAR_LEAVE_PX = 190;
export const WAKE_DISTANCE_PX = 110;
export const STARTLE_DISTANCE_PX = 240;
export const STARTLE_SPEED_PX_S = 2500;
export const STARTLE_COOLDOWN_MS = 8000;

/** Cliques rápidos. */
export const GIGGLE_CLICKS = 3;
export const GIGGLE_WINDOW_MS = 1200;
export const ANNOYED_CLICKS = 7;
export const ANNOYED_WINDOW_MS = 3000;

/** Afeto (0..1): sobe com carinho e decai com o tempo. */
export const AFFECTION_START = 0.5;
export const AFFECTION_PER_PET = 0.12;
export const AFFECTION_ANNOYED_PENALTY = 0.1;
export const AFFECTION_DECAY = 0.03;
export const AFFECTION_DECAY_MS = 30_000;
export const MOOD_LOW_BELOW = 0.25;
export const MOOD_HIGH_ABOVE = 0.65;
