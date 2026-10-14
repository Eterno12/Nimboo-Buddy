/**
 * Agenda (somente leitura) vinda de um endereço iCal (por exemplo, o "endereço secreto no formato iCal"
 * do Google Agenda). Tipos e regras puras, sem Electron nem rede.
 */

import { TASK_TITLE_MAX } from './tasks.ts';

export interface CalendarEvent {
  /** Estável por ocorrência: `<uid>|<início em ms>`. */
  id: string;
  title: string;
  /** ISO 8601 UTC. Em eventos de dia inteiro, é a meia-noite LOCAL do dia (convertida para UTC). */
  start: string;
  /** ISO 8601 UTC; exclusivo em eventos de dia inteiro. */
  end: string;
  allDay: boolean;
  location: string | null;
}

/** Uma agenda conectada (o endereço nunca sai do processo principal). */
export interface CalendarSource {
  slot: number;
  host: string | null;
  lastSync: string | null;
  error: string | null;
}

/** Quantas agendas podem ficar conectadas ao mesmo tempo. */
export const CALENDAR_MAX_SOURCES = 5;

export interface CalendarState {
  /** Agendas conectadas (vazio = nenhuma). `configured`/`host`/`error`/`lastSync` resumem todas. */
  sources: CalendarSource[];
  /** Há um endereço salvo (o endereço em si nunca vai para a interface). */
  configured: boolean;
  /** Só o domínio, para a pessoa reconhecer (ex.: `calendar.google.com`). */
  host: string | null;
  /** Última sincronização bem-sucedida (ISO UTC) ou `null`. */
  lastSync: string | null;
  /** Falha da última tentativa, em português, ou `null`. */
  error: string | null;
  /** Eventos dos próximos dias (hoje + alguns dias), em ordem. */
  events: CalendarEvent[];
  /** Salvar o endereço exige o cofre do Windows (DPAPI); `false` = indisponível. */
  canStore: boolean;
}

export const EMPTY_CALENDAR: CalendarState = Object.freeze({
  sources: [],
  configured: false,
  host: null,
  lastSync: null,
  error: null,
  events: [],
  canStore: true,
}) as CalendarState;

export type CalendarResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** Quantos dias à frente a agenda é carregada. */
export const CALENDAR_DAYS_AHEAD = 7;
/** Tamanho máximo do arquivo baixado (bytes). */
export const CALENDAR_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Valida o endereço: só `https://`, sem usuário/senha, sem IP literal nem `localhost` (o endereço é
 * buscado pelo app; não deve apontar para a própria máquina ou a rede local). Devolve o texto
 * normalizado ou a mensagem para a pessoa.
 */
export function validateCalendarUrl(input: unknown): CalendarResult<string> {
  if (typeof input !== 'string') return { ok: false, message: 'Cole o endereço da agenda.' };
  const text = input.trim();
  if (text.length === 0) return { ok: false, message: 'Cole o endereço da agenda.' };
  if (text.length > 2000) return { ok: false, message: 'Esse endereço é longo demais.' };
  let url: URL;
  try {
    url = new URL(text.replace(/^webcal:\/\//i, 'https://'));
  } catch {
    return { ok: false, message: 'Isso não parece um endereço válido.' };
  }
  if (url.protocol !== 'https:') return { ok: false, message: 'O endereço precisa começar com https://.' };
  if (url.username || url.password) return { ok: false, message: 'Endereço com usuário e senha não é aceito.' };
  const host = url.hostname.toLowerCase();
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIpv6 = host.startsWith('[') || host.includes(':');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isIpv4 || isIpv6 || !host.includes('.')) {
    return { ok: false, message: 'Use o endereço público da agenda (https://calendar.google.com/...).' };
  }
  return { ok: true, value: url.toString() };
}

/** Início do dia local de `date` e do dia seguinte (ms). */
export function dayBounds(date: Date): { start: number; end: number } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return { start, end };
}

/** O evento acontece (total ou parcialmente) no dia local de `date`. */
export function happensOn(event: CalendarEvent, date: Date): boolean {
  const { start, end } = dayBounds(date);
  const s = Date.parse(event.start);
  const e = Date.parse(event.end);
  return s < end && Math.max(e, s + 1) > start;
}

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "09:30" ou "Dia todo". */
export function eventTimeLabel(event: CalendarEvent): string {
  return event.allDay ? 'Dia todo' : timeFormat.format(new Date(event.start));
}

/**
 * Eventos de hoje na ordem em que interessam: os de dia inteiro primeiro, depois os que ainda não
 * terminaram por horário; os que já terminaram vêm por último (a interface pode esmaecê-los).
 */
export function todaysAgenda(events: readonly CalendarEvent[], now: Date): CalendarEvent[] {
  const today = events.filter((e) => happensOn(e, now));
  const ms = now.getTime();
  const rank = (e: CalendarEvent) => (e.allDay ? 0 : Date.parse(e.end) <= ms ? 2 : 1);
  return [...today].sort((a, b) => rank(a) - rank(b) || Date.parse(a.start) - Date.parse(b.start));
}

/** Dados para criar a tarefa de um evento (o botão "Virar tarefa"). */
export interface TaskFromEvent {
  title: string;
  /** Início do evento, se ainda for futuro; dia inteiro e eventos em andamento ficam sem prazo. */
  dueAt: string | null;
  /** Id estável do evento: a tarefa guarda isso para não duplicar e para não avisar duas vezes. */
  sourceRef: string;
}

/** O evento ainda pode virar tarefa (não terminou). */
export function canBecomeTask(event: CalendarEvent, now: Date): boolean {
  return event.allDay || Date.parse(event.end) > now.getTime();
}

/**
 * Como um evento da agenda vira tarefa: o mesmo título (cortado em 200 caracteres) e, se o evento é
 * com horário e ainda não começou, o início como prazo (os lembretes já existentes passam a valer).
 * Evento de dia inteiro vira tarefa sem prazo.
 */
export function taskFromEvent(event: CalendarEvent, now: Date): TaskFromEvent {
  const chars = [...event.title.trim().replace(/\s+/g, ' ')];
  let title = chars.slice(0, TASK_TITLE_MAX).join('').trimEnd();
  if (title.length === 0) title = 'Evento sem título';
  const start = Date.parse(event.start);
  const future = !event.allDay && Number.isFinite(start) && start > now.getTime();
  return { title, dueAt: future ? new Date(start).toISOString() : null, sourceRef: event.id };
}