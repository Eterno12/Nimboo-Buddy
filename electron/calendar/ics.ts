import type { CalendarEvent } from '../../shared/calendar.ts';

/**
 * Leitor de iCalendar (RFC 5545) para o que uma agenda pessoal usa: eventos simples, de dia inteiro,
 * com fuso (TZID), recorrentes (RRULE DAILY/WEEKLY/MONTHLY/YEARLY com INTERVAL, COUNT, UNTIL, BYDAY,
 * BYMONTHDAY), exceções (EXDATE), ocorrências alteradas (RECURRENCE-ID) e canceladas. Sem rede: recebe
 * o texto e a janela de interesse e devolve as ocorrências dentro dela.
 */

interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface IcsDate {
  /** Instante (ms UTC); em dia inteiro, a meia-noite local. */
  ms: number;
  allDay: boolean;
  /** Fuso do relógio de parede ("TZID") ou `null` = relógio do computador/UTC. */
  tzid: string | null;
  /** UTC explícito (sufixo Z): não tem relógio de parede a respeitar. */
  utc: boolean;
  /** Componentes de parede (para expandir recorrências respeitando horário de verão). */
  wall: { y: number; mo: number; d: number; h: number; mi: number; s: number };
}

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  until: number | null;
  byDay: { ord: number; day: number }[];
  byMonthDay: number[];
}

interface RawEvent {
  uid: string;
  summary: string;
  location: string | null;
  start: IcsDate;
  end: IcsDate | null;
  durationMs: number | null;
  rule: Rule | null;
  exdates: Set<number>;
  recurrenceId: number | null;
  cancelled: boolean;
}

const DAY_MS = 86_400_000;
const MAX_OCCURRENCES = 2000;
const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Desfaz "dobras" de linha (RFC 5545 §3.1) e separa em linhas. */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) lines[lines.length - 1] += raw.slice(1);
    else lines.push(raw);
  }
  return lines;
}

function parseProp(line: string): IcsProp | null {
  // O primeiro ":" fora de aspas separa nome+parâmetros do valor.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

/** TEXT: remove escapes (`\n`, `\,`, `\;`, `\\`). */
function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_m, c: string) => (c === 'n' || c === 'N' ? ' ' : c)).trim();
}

/** Deslocamento (ms) do fuso `tz` no instante `utcMs`; `null` se o fuso não existe. */
function tzOffsetMs(utcMs: number, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
    return asUtc - Math.floor(utcMs / 1000) * 1000;
  } catch {
    return null;
  }
}

/** Relógio de parede de `tz` → instante UTC (trata a hora repetida/inexistente do horário de verão). */
export function zonedToUtc(
  w: { y: number; mo: number; d: number; h: number; mi: number; s: number },
  tz: string | null,
): number {
  if (tz === null) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s).getTime();
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  const off1 = tzOffsetMs(guess, tz);
  if (off1 === null) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s).getTime(); // fuso desconhecido
  const first = guess - off1;
  const off2 = tzOffsetMs(first, tz);
  return off2 === null || off2 === off1 ? first : guess - off2;
}

function parseDate(value: string, params: Record<string, string>): IcsDate | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dateOnly = m[4] === undefined || params['VALUE'] === 'DATE';
  if (dateOnly) {
    return {
      ms: new Date(y, mo - 1, d).getTime(),
      allDay: true,
      tzid: null,
      utc: false,
      wall: { y, mo, d, h: 0, mi: 0, s: 0 },
    };
  }
  const wall = { y, mo, d, h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0) };
  if (m[7] === 'Z') return { ms: Date.UTC(y, mo - 1, d, wall.h, wall.mi, wall.s), allDay: false, tzid: null, utc: true, wall };
  const tz = params['TZID'] ?? null;
  const known = tz !== null && tzOffsetMs(Date.UTC(y, mo - 1, d), tz) !== null;
  return { ms: zonedToUtc(wall, known ? tz : null), allDay: false, tzid: known ? tz : null, utc: false, wall };
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const [w, d, h, mi, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
  return sign * (((w * 7 + d) * 24 + h) * 3600 + mi * 60 + s) * 1000;
}

function parseRule(value: string, params: Record<string, string>): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv['FREQ'] as Rule['freq'] | undefined;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  const until = kv['UNTIL'] ? parseDate(kv['UNTIL'], params) : null;
  const byDay: Rule['byDay'] = [];
  for (const token of (kv['BYDAY'] ?? '').split(',').filter(Boolean)) {
    const dm = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token.trim());
    if (dm) byDay.push({ ord: dm[1] ? Number(dm[1]) : 0, day: WEEKDAYS[dm[2]] });
  }
  return {
    freq,
    interval: Math.max(1, Number(kv['INTERVAL'] ?? 1) || 1),
    count: kv['COUNT'] ? Math.max(1, Number(kv['COUNT']) || 1) : null,
    // UNTIL em dia inteiro vale até o fim daquele dia.
    until: until ? (until.allDay ? until.ms + DAY_MS - 1 : until.ms) : null,
    byDay,
    byMonthDay: (kv['BYMONTHDAY'] ?? '')
      .split(',')
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n !== 0),
  };
}

/** Lê os VEVENT de um texto iCalendar. */
export function parseEvents(text: string): RawEvent[] {
  const events: RawEvent[] = [];
  let current: Partial<RawEvent> & { props?: IcsProp[] } | null = null;
  let depth = 0; // VALARM etc. aninhados dentro do VEVENT são ignorados

  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = { props: [], exdates: new Set<number>(), cancelled: false };
      depth = 0;
      continue;
    }
    if (!current) continue;
    if (line.startsWith('BEGIN:')) {
      depth++;
      continue;
    }
    if (line === 'END:VEVENT' && depth === 0) {
      const ev = finish(current);
      if (ev) events.push(ev);
      current = null;
      continue;
    }
    if (line.startsWith('END:')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    const prop = parseProp(line);
    if (prop) current.props!.push(prop);
  }
  return events;
}

function finish(partial: Partial<RawEvent> & { props?: IcsProp[] }): RawEvent | null {
  const props = partial.props ?? [];
  const find = (name: string) => props.find((p) => p.name === name);
  const start = find('DTSTART');
  if (!start) return null;
  const startDate = parseDate(start.value, start.params);
  if (!startDate) return null;
  const endProp = find('DTEND');
  const durProp = find('DURATION');
  const rruleProp = find('RRULE');
  const rid = find('RECURRENCE-ID');
  const exdates = new Set<number>();
  for (const p of props.filter((x) => x.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const d = parseDate(v, p.params);
      if (d) exdates.add(d.ms);
    }
  }
  const status = (find('STATUS')?.value ?? '').toUpperCase();
  return {
    uid: find('UID')?.value ?? `${startDate.ms}`,
    summary: unescapeText(find('SUMMARY')?.value ?? '') || '(sem título)',
    location: unescapeText(find('LOCATION')?.value ?? '') || null,
    start: startDate,
    end: endProp ? parseDate(endProp.value, endProp.params) : null,
    durationMs: durProp ? parseDuration(durProp.value) : null,
    rule: rruleProp ? parseRule(rruleProp.value, rruleProp.params) : null,
    exdates,
    recurrenceId: rid ? (parseDate(rid.value, rid.params)?.ms ?? null) : null,
    cancelled: status === 'CANCELLED',
  };
}

/** Duração do evento (ms): DTEND, DURATION ou o padrão (dia inteiro = 1 dia; com hora = 0). */
function lengthOf(e: RawEvent): number {
  if (e.end) return Math.max(0, e.end.ms - e.start.ms);
  if (e.durationMs !== null) return Math.max(0, e.durationMs);
  return e.start.allDay ? DAY_MS : 0;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

/** Início da ocorrência (ms) a partir de uma data de parede, no mesmo fuso do evento. */
function occurrenceStart(e: RawEvent, w: Wall): number {
  if (e.start.allDay) return new Date(w.y, w.mo - 1, w.d).getTime();
  if (e.start.utc) return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return zonedToUtc(w, e.start.tzid);
}

const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const weekdayOf = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

/** Datas de parede (sem hora) de cada ocorrência, em ordem, até `limitMs` (instante máximo). */
function* walls(e: RawEvent, rule: Rule, limitMs: number, fromMs: number): Generator<Wall> {
  const s = e.start.wall;
  const timeOf = (y: number, mo: number, d: number): Wall => ({ y, mo, d, h: s.h, mi: s.mi, s: s.s });
  let produced = 0;
  const startUtc = Date.UTC(s.y, s.mo - 1, s.d);
  const emit = (w: Wall): 'skip' | 'stop' | 'ok' => {
    if (Date.UTC(w.y, w.mo - 1, w.d) < startUtc) return 'skip';
    const ms = occurrenceStart(e, w);
    if (rule.until !== null && ms > rule.until) return 'stop';
    if (ms > limitMs) return 'stop';
    return 'ok';
  };

  const iterLimit = MAX_OCCURRENCES * 2;
  let guard = 0;
  // Sem COUNT, pula direto para perto da janela (uma agenda antiga não esgota o limite de iterações).
  // Com COUNT a contagem começa no início, então percorre desde lá (COUNT costuma ser pequeno).
  const fast = rule.count === null;
  const skipTo = (unitMs: number, origin: number, interval: number) =>
    fast ? Math.max(0, Math.floor((Math.floor((fromMs - origin) / unitMs) - 2) / interval) * interval) : 0;

  if (rule.freq === 'DAILY') {
    for (let i = skipTo(DAY_MS, startUtc, rule.interval); guard++ < iterLimit; i += rule.interval) {
      const dt = new Date(Date.UTC(s.y, s.mo - 1, s.d + i));
      const w = timeOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      const r = emit(w);
      if (r === 'stop') return;
      if (r === 'ok') {
        yield w;
        if (rule.count !== null && ++produced >= rule.count) return;
      }
    }
    return;
  }

  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length > 0 ? rule.byDay.map((b) => b.day) : [weekdayOf(s.y, s.mo, s.d)];
    // Semana começa na segunda-feira.
    const startDow = (weekdayOf(s.y, s.mo, s.d) + 6) % 7;
    const weekStart = Date.UTC(s.y, s.mo - 1, s.d) - startDow * DAY_MS;
    const order = [...new Set(days)].map((d) => (d + 6) % 7).sort((a, b) => a - b);
    for (let wk = skipTo(7 * DAY_MS, weekStart, rule.interval); guard++ < iterLimit; wk += rule.interval) {
      for (const dow of order) {
        const dt = new Date(weekStart + (wk * 7 + dow) * DAY_MS);
        const w = timeOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
        const r = emit(w);
        if (r === 'stop') return;
        if (r === 'ok') {
          yield w;
          if (rule.count !== null && ++produced >= rule.count) return;
        }
      }
    }
    return;
  }

  if (rule.freq === 'MONTHLY') {
    const monthsFromStart = fast ? Math.max(0, (new Date(fromMs).getUTCFullYear() - s.y) * 12 + new Date(fromMs).getUTCMonth() - (s.mo - 1) - 2) : 0;
    for (let k = Math.floor(monthsFromStart / rule.interval) * rule.interval; guard++ < iterLimit; k += rule.interval) {
      const base = new Date(Date.UTC(s.y, s.mo - 1 + k, 1));
      const y = base.getUTCFullYear();
      const mo = base.getUTCMonth() + 1;
      const dim = daysInMonth(y, mo);
      const picked: number[] = [];
      if (rule.byDay.length > 0) {
        for (const b of rule.byDay) {
          const cands: number[] = [];
          for (let d = 1; d <= dim; d++) if (weekdayOf(y, mo, d) === b.day) cands.push(d);
          if (b.ord === 0) picked.push(...cands);
          else {
            const idx = b.ord > 0 ? b.ord - 1 : cands.length + b.ord;
            if (cands[idx] !== undefined) picked.push(cands[idx]);
          }
        }
      } else if (rule.byMonthDay.length > 0) {
        for (const d of rule.byMonthDay) {
          const day = d > 0 ? d : dim + d + 1;
          if (day >= 1 && day <= dim) picked.push(day);
        }
      } else if (s.d <= dim) {
        picked.push(s.d); // ex.: dia 31 não existe em meses curtos: pula o mês
      }
      for (const d of [...new Set(picked)].sort((a, b) => a - b)) {
        const w = timeOf(y, mo, d);
        const r = emit(w);
        if (r === 'stop') return;
        if (r === 'ok') {
          yield w;
          if (rule.count !== null && ++produced >= rule.count) return;
        }
      }
    }
    return;
  }

  // YEARLY
  const yearsFromStart = fast ? Math.max(0, new Date(fromMs).getUTCFullYear() - s.y - 1) : 0;
  for (let k = Math.floor(yearsFromStart / rule.interval) * rule.interval; guard++ < iterLimit; k += rule.interval) {
    const y = s.y + k;
    if (s.d > daysInMonth(y, s.mo)) continue; // 29/02 em ano comum
    const w = timeOf(y, s.mo, s.d);
    const r = emit(w);
    if (r === 'stop') return;
    if (r === 'ok') {
      yield w;
      if (rule.count !== null && ++produced >= rule.count) return;
    }
  }
}

/**
 * Ocorrências que tocam a janela [from, to) (ms). Eventos cancelados e exceções (EXDATE) são
 * omitidos; ocorrências alteradas (RECURRENCE-ID) substituem a original.
 */
export function expandEvents(text: string, from: number, to: number): CalendarEvent[] {
  const raw = parseEvents(text);
  const overrides = new Map<string, RawEvent>();
  for (const e of raw) if (e.recurrenceId !== null) overrides.set(`${e.uid}|${e.recurrenceId}`, e);

  const out: CalendarEvent[] = [];
  const add = (e: RawEvent, startMs: number) => {
    const len = lengthOf(e);
    const endMs = startMs + len;
    if (e.cancelled) return;
    if (startMs >= to || Math.max(endMs, startMs + 1) <= from) return;
    out.push({
      id: `${e.uid}|${startMs}`,
      title: e.summary,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      allDay: e.start.allDay,
      location: e.location,
    });
  };

  for (const e of raw) {
    if (e.recurrenceId !== null) {
      // Uma ocorrência alterada vale pelo próprio horário novo (o original é suprimido abaixo).
      add(e, e.start.ms);
      continue;
    }
    if (!e.rule) {
      add(e, e.start.ms);
      continue;
    }
    const len = lengthOf(e);
    let seen = 0;
    for (const w of walls(e, e.rule, to, from)) {
      if (++seen > MAX_OCCURRENCES) break;
      const startMs = occurrenceStart(e, w);
      if (e.exdates.has(startMs)) continue;
      if (overrides.has(`${e.uid}|${startMs}`)) continue; // substituída por uma versão alterada
      if (startMs + Math.max(len, 1) <= from) continue;
      add(e, startMs);
    }
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
}
