import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CalendarSync,
  FetchError,
  SYNC_INTERVAL_MS,
  type CacheStore,
  type SecretStore,
} from '../electron/calendar/calendarSync.ts';
import type { CalendarEvent, CalendarState } from '../shared/calendar.ts';

const URL_OK = 'https://calendar.google.com/calendar/ical/abc%40gmail.com/private-segredo123/basic.ics';

function ics(title: string, iso = '20260610T150000Z', end = '20260610T160000Z') {
  return [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1@x',
    `SUMMARY:${title}`,
    `DTSTART:${iso}`,
    `DTEND:${end}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function setup(options: { available?: boolean; stored?: string | null; cached?: { lastSync: string; events: CalendarEvent[] } | null } = {}) {
  let stored = options.stored ?? null;
  let cached = options.cached ?? null;
  const secret: SecretStore = {
    available: () => options.available ?? true,
    read: () => stored,
    write: (s) => void (stored = s),
    remove: () => void (stored = null),
  };
  const cache: CacheStore = {
    read: () => cached,
    write: (v) => void (cached = v),
    remove: () => void (cached = null),
  };
  const calls: string[] = [];
  let body: string | Error = ics('Reunião');
  const states: CalendarState[] = [];
  const delivered: CalendarEvent[][] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const sync = new CalendarSync({
    secret,
    cache,
    now: () => new Date('2026-06-10T09:00:00Z'),
    fetchText: async (url) => {
      calls.push(url);
      if (body instanceof Error) throw body;
      return body;
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
    onChange: (s) => states.push(s),
    onEvents: (e) => delivered.push(e),
  });
  return {
    sync,
    calls,
    states,
    delivered,
    timers,
    stored: () => stored,
    cached: () => cached,
    setBody: (b: string | Error) => void (body = b),
  };
}

test('salvar um endereço válido: guarda no cofre, baixa, lista os eventos e agenda a próxima sincronização', async () => {
  const t = setup();
  const r = await t.sync.setUrl(URL_OK);
  assert.ok(r.ok);
  assert.equal(t.stored(), URL_OK);
  assert.equal(t.calls.length, 1);
  const s = t.sync.getState();
  assert.equal(s.configured, true);
  assert.equal(s.host, 'calendar.google.com');
  assert.equal(s.error, null);
  assert.equal(s.lastSync, '2026-06-10T09:00:00.000Z');
  assert.deepEqual(s.events.map((e) => e.title), ['Reunião']);
  assert.equal(t.cached()!.events.length, 1);
  assert.equal(t.timers.at(-1)!.ms, SYNC_INTERVAL_MS);
});

test('o estado entregue às janelas nunca contém o endereço (nem o segredo)', async () => {
  const t = setup();
  await t.sync.setUrl(URL_OK);
  const dump = JSON.stringify([t.sync.getState(), ...t.states]);
  assert.ok(!dump.includes('segredo123'));
  assert.ok(!dump.includes('private-'));
});

test('endereço inválido ou sem cofre: recusa sem guardar nada', async () => {
  const t = setup();
  const bad = await t.sync.setUrl('http://x.com/a.ics');
  assert.ok(!bad.ok);
  assert.equal(t.stored(), null);
  const noVault = setup({ available: false });
  const r = await noVault.sync.setUrl(URL_OK);
  assert.ok(!r.ok && /cofre/.test(r.message));
  assert.equal(noVault.stored(), null);
  assert.equal(noVault.sync.getState().canStore, false);
});

test('primeira leitura falha (endereço errado): desfaz e não deixa nada guardado', async () => {
  const t = setup();
  t.setBody(new FetchError('A agenda não foi encontrada (código 404).'));
  const r = await t.sync.setUrl(URL_OK);
  assert.ok(!r.ok && /404/.test(r.message));
  assert.equal(t.stored(), null);
  assert.equal(t.sync.getState().configured, false);
});

test('texto que não é iCal é recusado com mensagem clara', async () => {
  const t = setup();
  t.setBody('<html>Página de login</html>');
  const r = await t.sync.setUrl(URL_OK);
  assert.ok(!r.ok && /iCal/.test(r.message));
});

test('falha depois de já ter dados: mantém os eventos e mostra o erro; recupera na próxima', async () => {
  const t = setup();
  await t.sync.setUrl(URL_OK);
  t.setBody(new FetchError('Sem conexão com a internet.'));
  await t.sync.refresh();
  let s = t.sync.getState();
  assert.equal(s.error, 'Sem conexão com a internet.');
  assert.deepEqual(s.events.map((e) => e.title), ['Reunião'], 'não apaga o que já havia');
  t.setBody(ics('Nova', '20260611T100000Z', '20260611T110000Z'));
  await t.sync.refresh();
  s = t.sync.getState();
  assert.equal(s.error, null);
  assert.deepEqual(s.events.map((e) => e.title), ['Nova']);
});

test('erro desconhecido vira mensagem genérica (sem vazar detalhes)', async () => {
  const t = setup();
  await t.sync.setUrl(URL_OK);
  t.setBody(new Error('ECONNRESET https://calendar.google.com/.../private-segredo123'));
  await t.sync.refresh();
  const s = t.sync.getState();
  assert.ok(s.error && !s.error.includes('segredo123'));
});

test('ao abrir o app: usa o endereço salvo e a cópia local antes mesmo da rede', async () => {
  const cachedEvent: CalendarEvent = {
    id: 'c|1',
    title: 'Guardado',
    start: '2026-06-10T14:00:00.000Z',
    end: '2026-06-10T15:00:00.000Z',
    allDay: false,
    location: null,
  };
  const old: CalendarEvent = { ...cachedEvent, id: 'c|0', title: 'Ontem', start: '2026-06-01T10:00:00.000Z', end: '2026-06-01T11:00:00.000Z' };
  const t = setup({ stored: URL_OK, cached: { lastSync: '2026-06-10T08:00:00.000Z', events: [old, cachedEvent] } });
  t.setBody(new FetchError('Sem conexão com a internet.'));
  t.sync.start();
  const first = t.sync.getState();
  assert.equal(first.configured, true);
  assert.deepEqual(first.events.map((e) => e.title), ['Guardado'], 'o que já passou não aparece');
  await t.sync.refresh();
  assert.deepEqual(t.sync.getState().events.map((e) => e.title), ['Guardado'], 'offline: segue com a cópia');
  assert.ok(t.sync.getState().error);
});

test('remover: apaga endereço, cópia e eventos; nada mais é baixado', async () => {
  const t = setup();
  await t.sync.setUrl(URL_OK);
  const before = t.calls.length;
  const s = await t.sync.clear();
  assert.equal(s.configured, false);
  assert.equal(s.events.length, 0);
  assert.equal(t.stored(), null);
  assert.equal(t.cached(), null);
  await t.sync.refresh();
  assert.equal(t.calls.length, before);
  assert.equal(t.delivered.at(-1)!.length, 0, 'lembretes da agenda são cancelados');
});

test('atualizações simultâneas compartilham uma só ida à rede', async () => {
  const t = setup();
  await t.sync.setUrl(URL_OK);
  const before = t.calls.length;
  await Promise.all([t.sync.refresh(), t.sync.refresh(), t.sync.refresh()]);
  assert.equal(t.calls.length, before + 1);
});
