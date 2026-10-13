import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandEvents, parseEvents, zonedToUtc } from '../electron/calendar/ics.ts';
import {
  eventTimeLabel,
  happensOn,
  todaysAgenda,
  validateCalendarUrl,
  type CalendarEvent,
} from '../shared/calendar.ts';

const wrap = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//teste//', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const utc = (s: string) => Date.parse(s);
const WIDE_FROM = utc('2026-01-01T00:00:00Z');
const WIDE_TO = utc('2027-01-01T00:00:00Z');

test('evento simples em UTC dentro da janela; fora dela some', () => {
  const ics = wrap(
    ev('UID:a@x', 'SUMMARY:Reunião', 'DTSTART:20260610T120000Z', 'DTEND:20260610T130000Z', 'LOCATION:Sala 3'),
    ev('UID:b@x', 'SUMMARY:Outra', 'DTSTART:20260701T120000Z', 'DTEND:20260701T130000Z'),
  );
  const r = expandEvents(ics, utc('2026-06-10T00:00:00Z'), utc('2026-06-11T00:00:00Z'));
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Reunião');
  assert.equal(r[0].start, '2026-06-10T12:00:00.000Z');
  assert.equal(r[0].end, '2026-06-10T13:00:00.000Z');
  assert.equal(r[0].location, 'Sala 3');
  assert.equal(r[0].allDay, false);
});

test('fuso (TZID): 09:00 em São Paulo = 12:00Z; fuso desconhecido cai no relógio local', () => {
  assert.equal(
    zonedToUtc({ y: 2026, mo: 6, d: 10, h: 9, mi: 0, s: 0 }, 'America/Sao_Paulo'),
    utc('2026-06-10T12:00:00Z'),
  );
  const ics = wrap(
    ev('UID:z@x', 'SUMMARY:Aula', 'DTSTART;TZID=America/Sao_Paulo:20260610T090000', 'DTEND;TZID=America/Sao_Paulo:20260610T100000'),
    ev('UID:u@x', 'SUMMARY:Estranho', 'DTSTART;TZID=Fuso/Que/Nao/Existe:20260610T090000', 'DTEND;TZID=Fuso/Que/Nao/Existe:20260610T100000'),
  );
  const r = expandEvents(ics, WIDE_FROM, WIDE_TO);
  assert.equal(r.find((e) => e.title === 'Aula')!.start, '2026-06-10T12:00:00.000Z');
  const local = new Date(2026, 5, 10, 9, 0).toISOString();
  assert.equal(r.find((e) => e.title === 'Estranho')!.start, local);
});

test('dia inteiro: começa à meia-noite local e termina (exclusivo) no dia seguinte', () => {
  const ics = wrap(ev('UID:d@x', 'SUMMARY:Feriado', 'DTSTART;VALUE=DATE:20260610', 'DTEND;VALUE=DATE:20260611'));
  const [e] = expandEvents(ics, WIDE_FROM, WIDE_TO);
  assert.equal(e.allDay, true);
  assert.equal(e.start, new Date(2026, 5, 10).toISOString());
  assert.equal(e.end, new Date(2026, 5, 11).toISOString());
  assert.ok(happensOn(e, new Date(2026, 5, 10, 15, 0)));
  assert.ok(!happensOn(e, new Date(2026, 5, 11, 1, 0)), 'o fim é exclusivo');
  assert.equal(eventTimeLabel(e), 'Dia todo');
});

test('semanal com BYDAY e COUNT', () => {
  const ics = wrap(
    ev('UID:w@x', 'SUMMARY:Treino', 'DTSTART:20260601T100000Z', 'DTEND:20260601T110000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5'),
  );
  const r = expandEvents(ics, WIDE_FROM, WIDE_TO);
  assert.deepEqual(
    r.map((e) => e.start.slice(0, 10)),
    ['2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10', '2026-06-15'],
  );
});

test('diário com INTERVAL, UNTIL e EXDATE', () => {
  const ics = wrap(
    ev(
      'UID:d@x',
      'SUMMARY:Remédio',
      'DTSTART:20260601T080000Z',
      'DTEND:20260601T081000Z',
      'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20260610T235959Z',
      'EXDATE:20260605T080000Z',
    ),
  );
  const r = expandEvents(ics, WIDE_FROM, WIDE_TO);
  assert.deepEqual(
    r.map((e) => e.start.slice(0, 10)),
    ['2026-06-01', '2026-06-03', '2026-06-07', '2026-06-09'],
    'sem o dia 5 (exceção) e nada depois do UNTIL',
  );
});

test('ocorrência alterada (RECURRENCE-ID) substitui a original; cancelada some', () => {
  const ics = wrap(
    ev('UID:r@x', 'SUMMARY:Daily', 'DTSTART:20260601T130000Z', 'DTEND:20260601T133000Z', 'RRULE:FREQ=DAILY;COUNT=4'),
    ev(
      'UID:r@x',
      'SUMMARY:Daily (remarcada)',
      'RECURRENCE-ID:20260602T130000Z',
      'DTSTART:20260602T170000Z',
      'DTEND:20260602T173000Z',
    ),
    ev('UID:r@x', 'SUMMARY:Daily', 'RECURRENCE-ID:20260603T130000Z', 'DTSTART:20260603T130000Z', 'DTEND:20260603T133000Z', 'STATUS:CANCELLED'),
  );
  const r = expandEvents(ics, WIDE_FROM, WIDE_TO);
  assert.deepEqual(
    r.map((e) => [e.title, e.start]),
    [
      ['Daily', '2026-06-01T13:00:00.000Z'],
      ['Daily (remarcada)', '2026-06-02T17:00:00.000Z'],
      ['Daily', '2026-06-04T13:00:00.000Z'],
    ],
  );
});

test('mensal: última sexta e dia 31 (pula meses curtos)', () => {
  const last = wrap(
    ev('UID:m@x', 'SUMMARY:Retro', 'DTSTART:20260130T150000Z', 'DTEND:20260130T160000Z', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3'),
  );
  assert.deepEqual(
    expandEvents(last, WIDE_FROM, WIDE_TO).map((e) => e.start.slice(0, 10)),
    ['2026-01-30', '2026-02-27', '2026-03-27'],
  );
  const d31 = wrap(
    ev('UID:n@x', 'SUMMARY:Fatura', 'DTSTART:20260131T120000Z', 'DTEND:20260131T130000Z', 'RRULE:FREQ=MONTHLY;COUNT=4'),
  );
  assert.deepEqual(
    expandEvents(d31, WIDE_FROM, WIDE_TO).map((e) => e.start.slice(0, 10)),
    ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'],
  );
});

test('anual (29/02 pula anos comuns)', () => {
  const ics = wrap(
    ev('UID:y@x', 'SUMMARY:Aniversário', 'DTSTART;VALUE=DATE:20240229', 'RRULE:FREQ=YEARLY;COUNT=2'),
  );
  const r = expandEvents(ics, utc('2024-01-01T00:00:00Z'), utc('2040-01-01T00:00:00Z'));
  assert.deepEqual(
    r.map((e) => e.start),
    [new Date(2024, 1, 29).toISOString(), new Date(2028, 1, 29).toISOString()],
  );
});

test('horário de verão: 09:00 de Nova York continua 09:00 local (muda em UTC)', () => {
  const ics = wrap(
    ev(
      'UID:ny@x',
      'SUMMARY:Stand-up',
      'DTSTART;TZID=America/New_York:20260302T090000',
      'DTEND;TZID=America/New_York:20260302T093000',
      'RRULE:FREQ=WEEKLY;COUNT=3',
    ),
  );
  const r = expandEvents(ics, WIDE_FROM, WIDE_TO);
  assert.deepEqual(
    r.map((e) => e.start),
    ['2026-03-02T14:00:00.000Z', '2026-03-09T13:00:00.000Z', '2026-03-16T13:00:00.000Z'],
  );
});

test('linhas dobradas, escapes e VALARM aninhado não confundem o leitor', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:f@x',
    'SUMMARY:Almoço\\, com a equipe\\; ',
    ' e sobremesa',
    'DTSTART:20260610T150000Z',
    'DTEND:20260610T160000Z',
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'SUMMARY:alarme (não é o título)',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');
  const [e] = expandEvents(ics, WIDE_FROM, WIDE_TO);
  assert.equal(e.title, 'Almoço, com a equipe; e sobremesa');
});

test('DURATION em vez de DTEND; evento sem fim com horário tem duração zero', () => {
  const ics = wrap(
    ev('UID:p@x', 'SUMMARY:Com duração', 'DTSTART:20260610T120000Z', 'DURATION:PT1H30M'),
    ev('UID:q@x', 'SUMMARY:Sem fim', 'DTSTART:20260610T140000Z'),
  );
  const r = expandEvents(ics, WIDE_FROM, WIDE_TO);
  assert.equal(r.find((e) => e.title === 'Com duração')!.end, '2026-06-10T13:30:00.000Z');
  assert.equal(r.find((e) => e.title === 'Sem fim')!.end, '2026-06-10T14:00:00.000Z');
});

test('lixo no arquivo não quebra: eventos inválidos são ignorados', () => {
  const ics = wrap(
    'isto não é uma linha válida',
    ev('SUMMARY:Sem início'),
    ev('UID:ok@x', 'SUMMARY:Bom', 'DTSTART:20260610T120000Z', 'DTEND:20260610T130000Z'),
    ev('UID:bad@x', 'SUMMARY:Data ruim', 'DTSTART:amanhã'),
  );
  assert.equal(parseEvents(ics).length, 1);
  assert.deepEqual(expandEvents('', WIDE_FROM, WIDE_TO), []);
  assert.deepEqual(expandEvents('\u0000\u0001 lixo binário', WIDE_FROM, WIDE_TO), []);
});

test('recorrência gigante é limitada (nunca trava)', () => {
  const ics = wrap(ev('UID:g@x', 'SUMMARY:Sempre', 'DTSTART:20000101T000000Z', 'DTEND:20000101T000100Z', 'RRULE:FREQ=DAILY'));
  const t0 = Date.now();
  const r = expandEvents(ics, utc('2026-06-01T00:00:00Z'), utc('2026-06-08T00:00:00Z'));
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.length, 7, 'uma por dia na janela, mesmo com a regra começando em 2000');
  assert.equal(r[0].start.slice(0, 10), '2026-06-01');
});

test('todaysAgenda: dia inteiro primeiro, depois os que ainda vêm, e os que já passaram por último', () => {
  const now = new Date(2026, 5, 10, 12, 0);
  const mk = (title: string, h: number, allDay = false): CalendarEvent => ({
    id: title,
    title,
    start: (allDay ? new Date(2026, 5, 10) : new Date(2026, 5, 10, h, 0)).toISOString(),
    end: (allDay ? new Date(2026, 5, 11) : new Date(2026, 5, 10, h + 1, 0)).toISOString(),
    allDay,
    location: null,
  });
  const list = todaysAgenda([mk('tarde', 16), mk('manhã', 8), mk('feriado', 0, true), mk('agora', 12), mk('amanhã', 9)].map((e) =>
    e.title === 'amanhã' ? { ...e, start: new Date(2026, 5, 11, 9).toISOString(), end: new Date(2026, 5, 11, 10).toISOString() } : e,
  ), now);
  assert.deepEqual(list.map((e) => e.title), ['feriado', 'agora', 'tarde', 'manhã']);
});

test('endereço: só https público, sem usuário/senha, sem IP nem localhost; webcal:// vira https', () => {
  const good = validateCalendarUrl('  https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics ');
  assert.ok(good.ok);
  assert.ok(good.ok && good.value.startsWith('https://calendar.google.com/'));
  const web = validateCalendarUrl('webcal://p01-caldav.icloud.com/published/2/abc');
  assert.ok(web.ok && web.value.startsWith('https://p01-caldav.icloud.com/'));
  for (const bad of [
    '',
    'não é um endereço',
    'http://calendar.google.com/x.ics',
    'https://user:pass@calendar.google.com/x.ics',
    'https://localhost/x.ics',
    'https://127.0.0.1/x.ics',
    'https://192.168.0.10/x.ics',
    'https://[::1]/x.ics',
    'https://intranet/x.ics',
    'ftp://calendar.google.com/x.ics',
    'https://' + 'a'.repeat(2100) + '.com/x.ics',
    42,
    null,
  ]) {
    assert.equal(validateCalendarUrl(bad).ok, false, String(bad).slice(0, 40));
  }
});


test('regras antigas (semanal/mensal/anual desde anos atrás) chegam à janela atual', () => {
  const win = [utc('2026-06-01T00:00:00Z'), utc('2026-06-30T00:00:00Z')] as const;
  const weekly = wrap(ev('UID:aw@x', 'SUMMARY:Semanal', 'DTSTART:20100104T100000Z', 'DTEND:20100104T110000Z', 'RRULE:FREQ=WEEKLY'));
  const wr = expandEvents(weekly, ...win);
  assert.ok(wr.length >= 4 && wr.every((e) => new Date(e.start).getUTCDay() === 1), `semanal: ${wr.length}`);
  const monthly = wrap(ev('UID:am@x', 'SUMMARY:Mensal', 'DTSTART:20120115T100000Z', 'DTEND:20120115T110000Z', 'RRULE:FREQ=MONTHLY'));
  assert.deepEqual(expandEvents(monthly, ...win).map((e) => e.start.slice(0, 10)), ['2026-06-15']);
  const yearly = wrap(ev('UID:ay@x', 'SUMMARY:Anual', 'DTSTART;VALUE=DATE:19900620', 'RRULE:FREQ=YEARLY'));
  assert.deepEqual(expandEvents(yearly, ...win).map((e) => e.start), [new Date(2026, 5, 20).toISOString()]);
  const bi = wrap(ev('UID:ab@x', 'SUMMARY:Quinzenal', 'DTSTART:20200106T100000Z', 'DTEND:20200106T110000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2'));
  const br = expandEvents(bi, ...win);
  assert.ok(br.length >= 2 && br.length <= 3);
  // 2020-01-06 + múltiplos de 14 dias: confere o alinhamento do intervalo
  for (const e of br) {
    const days = Math.round((Date.parse(e.start) - utc('2020-01-06T10:00:00Z')) / 86_400_000);
    assert.equal(days % 14, 0, e.start);
  }
});

// Evento da agenda → tarefa ----------------------------------------------------
import { canBecomeTask, taskFromEvent } from '../shared/calendar.ts';

const sampleEvent = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'uid-1@google.com|1777640400000',
  title: 'Reunião de equipe',
  start: '2026-05-01T13:00:00.000Z',
  end: '2026-05-01T14:00:00.000Z',
  allDay: false,
  location: null,
  ...over,
});

test('virar tarefa: evento futuro com horário usa o título, o início como prazo e o id como origem', () => {
  const now = new Date('2026-05-01T09:00:00.000Z');
  assert.deepEqual(taskFromEvent(sampleEvent(), now), {
    title: 'Reunião de equipe',
    dueAt: '2026-05-01T13:00:00.000Z',
    sourceRef: 'uid-1@google.com|1777640400000',
  });
});

test('virar tarefa: dia inteiro e evento em andamento ficam sem prazo', () => {
  const now = new Date('2026-05-01T13:30:00.000Z');
  assert.equal(taskFromEvent(sampleEvent(), now).dueAt, null, 'já começou');
  assert.equal(taskFromEvent(sampleEvent({ allDay: true, start: '2026-05-01T03:00:00.000Z' }), new Date('2026-05-01T01:00:00.000Z')).dueAt, null);
});

test('virar tarefa: título longo é cortado em 200 caracteres, espaços normalizados, vazio ganha nome', () => {
  const now = new Date('2026-05-01T09:00:00.000Z');
  const long = taskFromEvent(sampleEvent({ title: 'ab'.repeat(150) }), now).title;
  assert.equal([...long].length, 200);
  assert.equal(taskFromEvent(sampleEvent({ title: '  Almoço \n  com   a Ana ' }), now).title, 'Almoço com a Ana');
  assert.equal(taskFromEvent(sampleEvent({ title: '   ' }), now).title, 'Evento sem título');
  const emoji = taskFromEvent(sampleEvent({ title: '😀'.repeat(250) }), now).title;
  assert.equal([...emoji].length, 200, 'conta pontos de código, não unidades UTF-16');
});

test('virar tarefa: só eventos que ainda não terminaram', () => {
  assert.equal(canBecomeTask(sampleEvent(), new Date('2026-05-01T13:59:00.000Z')), true);
  assert.equal(canBecomeTask(sampleEvent(), new Date('2026-05-01T14:00:00.000Z')), false);
  assert.equal(canBecomeTask(sampleEvent({ allDay: true }), new Date('2026-05-01T20:00:00.000Z')), true);
});