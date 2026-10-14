import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  appLabel,
  currentPosition,
  EMPTY_MEDIA,
  formatTime,
  mediaLayout,
  nowPlayingText,
  parseMediaCommand,
  sanitizeMedia,
} from '../shared/media.ts';
import { mediaScript, parseMediaLine } from '../electron/media/mediaSession.ts';
import { parseAssistantCommand } from '../shared/assistant.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../shared/settings.ts';
import { ISLAND_EXTENTS, ISLAND_WINDOW_SIZE, islandShape } from '../shared/presentation.ts';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

test('mídia: valida o estado vindo do leitor e descarta o que não confere', () => {
  const s = sanitizeMedia({
    status: 'Playing',
    title: '  Garota de Ipanema\u0000 ',
    artist: 'Tom Jobim',
    album: 'x'.repeat(500),
    app: 'Spotify.exe',
    position: 12.5,
    duration: 200,
    updatedAt: 1_700_000_000_000,
    canPlayPause: true,
    canNext: true,
    canPrev: false,
    canSeek: 'sim',
  });
  assert.equal(s.available, true);
  assert.equal(s.status, 'playing');
  assert.equal(s.title, 'Garota de Ipanema');
  assert.equal(s.album.length, 120);
  assert.equal(s.app, 'Spotify');
  assert.equal(s.canSeek, false, 'só true literal vale');
  assert.equal(sanitizeMedia({ status: 'Banana' }).status, 'none');
  assert.equal(sanitizeMedia({ position: -5, duration: 'x' }).positionSec, 0);
  assert.equal(sanitizeMedia(null).available, true);
});

test('mídia: capa só aceita data:image base64 (nada de URL externa)', () => {
  assert.equal(sanitizeMedia({}, 'data:image/png;base64,AAAA').thumbnail, 'data:image/png;base64,AAAA');
  assert.equal(sanitizeMedia({}, 'https://evil.example/x.png').thumbnail, null);
  assert.equal(sanitizeMedia({}, 'data:text/html;base64,AAAA').thumbnail, null);
  assert.equal(sanitizeMedia({}, 'data:image/png;base64,<script>').thumbnail, null);
});

test('mídia: linhas do leitor (estado, capa, pronto, erro) e lixo', () => {
  assert.deepEqual(parseMediaLine('READY'), { type: 'ready' });
  const st = parseMediaLine(`STATE ${b64(JSON.stringify({ status: 'Paused', title: 'a' }))}`);
  assert.equal(st?.type, 'state');
  const th = parseMediaLine(`THUMB ${b64('image/jpeg')} QUJD`);
  assert.deepEqual(th, { type: 'thumb', mime: 'image/jpeg', base64: 'QUJD' });
  const empty = parseMediaLine(`THUMB ${b64('')} `);
  assert.deepEqual(empty, { type: 'thumb', mime: '', base64: '' });
  assert.equal(parseMediaLine(`ERR ${b64('boom')}`)?.type, 'error');
  assert.equal(parseMediaLine('STATE !!!não-é-base64-json'), null);
  assert.equal(parseMediaLine('qualquer coisa'), null);
  assert.equal(parseMediaLine(''), null);
});

test('mídia: posição estimada anda enquanto toca e para quando pausa', () => {
  const base = { ...EMPTY_MEDIA, available: true, positionSec: 10, durationSec: 100, updatedAt: 1000 };
  assert.equal(currentPosition({ ...base, status: 'playing' }, 6000), 15);
  assert.equal(currentPosition({ ...base, status: 'paused' }, 6000), 10);
  assert.equal(currentPosition({ ...base, status: 'playing' }, 1_000_000), 100, 'não passa da duração');
  assert.equal(formatTime(187), '3:07');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-4), '0:00');
});

test('mídia: layout da ilha (desligado, reduzido, tocando) e texto', () => {
  const playing = { ...EMPTY_MEDIA, available: true, status: 'playing' as const, title: 'T', artist: 'A' };
  assert.equal(mediaLayout(false, playing), 'off');
  assert.equal(mediaLayout(true, playing), 'playing');
  assert.equal(mediaLayout(true, { ...playing, status: 'paused' }), 'mini');
  assert.equal(mediaLayout(true, { ...EMPTY_MEDIA }), 'mini');
  assert.equal(nowPlayingText(playing), 'T — A');
  assert.equal(nowPlayingText({ ...playing, status: 'paused' }), 'T — A (pausado)');
  assert.equal(nowPlayingText(EMPTY_MEDIA), 'Nada tocando agora');
  assert.equal(appLabel('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'), 'Spotify');
  assert.equal(appLabel('chrome.exe'), 'Chrome');
  assert.equal(appLabel('MeuPlayer.exe'), 'MeuPlayer');
});

test('mídia: só comandos conhecidos vindos da interface', () => {
  assert.deepEqual(parseMediaCommand({ type: 'next' }), { type: 'next' });
  assert.deepEqual(parseMediaCommand({ type: 'seek', seconds: 30 }), { type: 'seek', seconds: 30 });
  assert.deepEqual(parseMediaCommand({ type: 'seek', seconds: 1e9 }), { type: 'seek', seconds: 86400 });
  assert.equal(parseMediaCommand({ type: 'seek', seconds: 'x' }), null);
  assert.equal(parseMediaCommand({ type: 'format-c' }), null);
  assert.equal(parseMediaCommand(null), null);
  assert.equal(parseMediaCommand('toggle'), null);
});

test('leitor: o script usa só a API de mídia do Windows (sem rede, sem executar texto)', () => {
  const script = mediaScript();
  assert.match(script, /GlobalSystemMediaTransportControlsSessionManager/);
  assert.match(script, /TryTogglePlayPauseAsync/);
  assert.match(script, /TrySkipNextAsync/);
  assert.match(script, /TrySkipPreviousAsync/);
  assert.match(script, /TryChangePlaybackPositionAsync/);
  assert.ok(!/Invoke-WebRequest|Net\.WebClient|Invoke-Expression|iex\b|Start-Process|DownloadString/i.test(script));
});

test('assistente: comandos de música e o que está tocando', () => {
  const p = (s: string) => parseAssistantCommand(s);
  assert.deepEqual(p('pausar a música'), { kind: 'media', action: 'pause' });
  assert.deepEqual(p('próxima música'), { kind: 'media', action: 'next' });
  assert.deepEqual(p('pula essa faixa'), { kind: 'media', action: 'next' });
  assert.deepEqual(p('música anterior'), { kind: 'media', action: 'prev' });
  assert.deepEqual(p('toca a música'), { kind: 'media', action: 'play' });
  assert.deepEqual(p('retomar música'), { kind: 'media', action: 'play' });
  assert.deepEqual(p('o que está tocando?'), { kind: 'media', action: 'now' });
  // não confunde com foco, notas e tarefas
  assert.equal(p('pausar foco').kind, 'focus.pause');
  assert.equal(p('iniciar foco de 25 minutos').kind, 'focus.start');
  assert.equal(p('crie uma tarefa ouvir música').kind, 'task.create');
  assert.equal(p('crie uma nota escrito playlist de música').kind, 'note.create');
});

test('preferências do player e geometria da ilha com o player', () => {
  assert.equal(DEFAULT_SETTINGS.mediaPlayer, true);
  assert.equal(DEFAULT_SETTINGS.mediaReact, true);
  assert.equal(parseSettings({ version: 3, mediaPlayer: false }).mediaPlayer, false);
  assert.equal(parseSettings({ version: 3, mediaPlayer: 'não' }).mediaPlayer, true);
  const heights = ISLAND_EXTENTS.map((e) => islandShape(true, e).height);
  const byName = Object.fromEntries(ISLAND_EXTENTS.map((e, i) => [e, heights[i]]));
  assert.ok(byName['home'] < byName['home-mini'] && byName['home-mini'] < byName['home-player']);
  assert.ok(byName['home-player'] < byName['tasks']);
  assert.equal(byName['tasks'], ISLAND_WINDOW_SIZE.height);
  for (const h of heights) assert.ok(h <= ISLAND_WINDOW_SIZE.height);
});
