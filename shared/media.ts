/**
 * Player de música da ilha: tipos e regras puras (sem Windows, DOM ou rede). O estado vem do Windows
 * (controle de mídia do sistema) e é lido só no processo principal.
 */

export type MediaStatus = 'none' | 'playing' | 'paused' | 'stopped';

export interface MediaState {
  /** O Windows consegue falar com o controle de mídia (falso se o leitor não iniciou). */
  available: boolean;
  status: MediaStatus;
  title: string;
  artist: string;
  album: string;
  /** Nome amigável do app que toca (Spotify, Chrome...). */
  app: string;
  /** Posição, em segundos, no instante `updatedAt`. */
  positionSec: number;
  durationSec: number;
  /** Quando `positionSec` foi medida (ms desde 1970, relógio do computador). */
  updatedAt: number;
  /** Capa em `data:image/...;base64,...` ou `null`. */
  thumbnail: string | null;
  canPlayPause: boolean;
  canNext: boolean;
  canPrev: boolean;
  canSeek: boolean;
}

export const EMPTY_MEDIA: MediaState = Object.freeze({
  available: false,
  status: 'none',
  title: '',
  artist: '',
  album: '',
  app: '',
  positionSec: 0,
  durationSec: 0,
  updatedAt: 0,
  thumbnail: null,
  canPlayPause: false,
  canNext: false,
  canPrev: false,
  canSeek: false,
}) as MediaState;

export type MediaCommand =
  | { type: 'toggle' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; seconds: number };

/** Como a tela inicial da ilha reserva espaço para o player. */
export type MediaLayout = 'off' | 'mini' | 'playing';

export function mediaLayout(enabled: boolean, state: MediaState): MediaLayout {
  if (!enabled) return 'off';
  return state.available && state.status === 'playing' ? 'playing' : 'mini';
}

/** Posição estimada agora (a Windows só informa de tempos em tempos). */
export function currentPosition(state: MediaState, now: number): number {
  if (state.status !== 'playing') return Math.max(0, Math.min(state.positionSec, state.durationSec || state.positionSec));
  const elapsed = Math.max(0, (now - state.updatedAt) / 1000);
  const p = state.positionSec + elapsed;
  return state.durationSec > 0 ? Math.min(p, state.durationSec) : p;
}

/** "3:07" / "1:02:09". */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const APP_NAMES: [RegExp, string][] = [
  [/spotify/i, 'Spotify'],
  [/chrome/i, 'Chrome'],
  [/msedge|edge/i, 'Edge'],
  [/firefox/i, 'Firefox'],
  [/brave/i, 'Brave'],
  [/opera/i, 'Opera'],
  [/vlc/i, 'VLC'],
  [/zunemusic|mediaplayer|groove/i, 'Media Player'],
  [/musicbee/i, 'MusicBee'],
  [/foobar/i, 'foobar2000'],
  [/itunes|applemusic/i, 'Apple Music'],
  [/youtubemusic/i, 'YouTube Music'],
  [/tidal/i, 'TIDAL'],
  [/deezer/i, 'Deezer'],
  [/amazon/i, 'Amazon Music'],
];

/** Nome amigável a partir do identificador do app (AUMID/executável). */
export function appLabel(raw: string): string {
  for (const [re, name] of APP_NAMES) if (re.test(raw)) return name;
  const base = raw.split(/[\\/!]/).pop() ?? raw;
  const clean = base.replace(/\.exe$/i, '').replace(/[._-]+/g, ' ').trim();
  return clean.length > 0 ? clean.slice(0, 40) : '';
}

const clampNum = (v: unknown, max = 1e7): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
const clampText = (v: unknown, n: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n) : '';

/** Valida o JSON vindo do leitor (nunca confia nos tipos). */
export function sanitizeMedia(raw: unknown, thumbnail: string | null = null): MediaState {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_MEDIA, available: true };
  const o = raw as Record<string, unknown>;
  const statusRaw = typeof o.status === 'string' ? o.status.toLowerCase() : 'none';
  const status: MediaStatus =
    statusRaw === 'playing' ? 'playing' : statusRaw === 'paused' ? 'paused' : statusRaw === 'stopped' ? 'stopped' : 'none';
  const app = clampText(o.app, 80);
  return {
    available: true,
    status,
    title: clampText(o.title, 140),
    artist: clampText(o.artist, 120),
    album: clampText(o.album, 120),
    app: appLabel(app),
    positionSec: clampNum(o.position),
    durationSec: clampNum(o.duration),
    updatedAt: clampNum(o.updatedAt, 8.64e15),
    thumbnail: typeof thumbnail === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(thumbnail) ? thumbnail : null,
    canPlayPause: o.canPlayPause === true,
    canNext: o.canNext === true,
    canPrev: o.canPrev === true,
    canSeek: o.canSeek === true,
  };
}

/** Comando validado (vindo da interface). */
export function parseMediaCommand(raw: unknown): MediaCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as { type?: unknown; seconds?: unknown };
  if (o.type === 'toggle' || o.type === 'play' || o.type === 'pause' || o.type === 'next' || o.type === 'prev') {
    return { type: o.type };
  }
  if (o.type === 'seek' && typeof o.seconds === 'number' && Number.isFinite(o.seconds)) {
    return { type: 'seek', seconds: Math.max(0, Math.min(86_400, o.seconds)) };
  }
  return null;
}

/** Texto de uma linha para a mini barra / assistente. */
export function nowPlayingText(state: MediaState): string {
  if (!state.available || state.status === 'none' || (!state.title && !state.artist)) return 'Nada tocando agora';
  const base = state.artist ? `${state.title || 'Faixa sem nome'} — ${state.artist}` : state.title;
  return state.status === 'paused' ? `${base} (pausado)` : base;
}
