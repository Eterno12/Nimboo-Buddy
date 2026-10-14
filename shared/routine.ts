/**
 * Rotina do dia: resumo da manhã e fechamento da noite. Puro (sem DOM, Electron ou rede): recebe as
 * tarefas, os eventos e as contagens e devolve o que mostrar; a interface só desenha.
 */
import type { CalendarEvent } from './calendar.ts';
import { dayBounds, eventTimeLabel, todaysAgenda } from './calendar.ts';
import type { Task } from './tasks.ts';

export type RoutineKind = 'morning' | 'evening';


export interface RoutineInput {
  now: Date;
  /** Tarefas ativas (principais e subtarefas; as subtarefas não entram na contagem). */
  active: readonly Task[];
  /** Tarefas concluídas ainda guardadas. */
  completed: readonly Task[];
  events: readonly CalendarEvent[];
  /** Foco concluído hoje. */
  focus: { sessions: number; minutes: number };
}

export interface RoutineSummary {
  kind: RoutineKind;
  /** Saudação curta ("Bom dia!", "Boa noite!"). */
  greeting: string;
  /** Linha curta para o balão do Mochi (cabe nos 56 caracteres do balão). */
  bubble: string;
  /** Linhas do cartão. */
  lines: string[];
  /** Tarefas que merecem atenção (atrasadas, de hoje, prioridade alta), até 3. */
  highlights: { id: string; title: string; reason: 'overdue' | 'today' | 'priority' }[];
  counts: {
    pending: number;
    overdue: number;
    dueToday: number;
    eventsToday: number;
    completedToday: number;
    focusSessions: number;
    focusMinutes: number;
  };
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Data local no formato `AAAA-MM-DD` (chave de "já mostrei hoje"). */
export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Qual cartão mostrar agora (ou `null`). O fechamento tem prioridade quando já é a hora; a manhã só
 * aparece antes do fechamento. Cada um aparece no máximo uma vez por dia (chave do último mostrado).
 */
export function pickRoutine(options: {
  now: Date;
  morningEnabled: boolean;
  eveningEnabled: boolean;
  eveningHour: number;
  lastMorning: string | null;
  lastEvening: string | null;
}): RoutineKind | null {
  const today = dayKey(options.now);
  const hour = options.now.getHours();
  if (options.eveningEnabled && hour >= options.eveningHour && options.lastEvening !== today) return 'evening';
  // Sem fechamento ligado, o resumo vale o dia todo; com ele, só antes da hora do fechamento.
  const beforeEvening = !options.eveningEnabled || hour < options.eveningHour;
  if (options.morningEnabled && beforeEvening && options.lastMorning !== today) return 'morning';
  return null;
}

/** Monta o resumo (manhã ou noite) a partir dos dados do dia. */
export function buildRoutine(kind: RoutineKind, input: RoutineInput): RoutineSummary {
  const { now } = input;
  const nowMs = now.getTime();
  const top = input.active.filter((t) => t.parentId === null);
  const { start, end } = dayBounds(now);

  const overdue = top.filter((t) => t.dueAt !== null && Date.parse(t.dueAt) < nowMs);
  const dueToday = top.filter((t) => {
    if (t.dueAt === null) return false;
    const ms = Date.parse(t.dueAt);
    return ms >= nowMs && ms < end;
  });
  const completedToday = input.completed.filter(
    (t) => t.parentId === null && t.completedAt !== null && sameDay(new Date(t.completedAt), now) && Date.parse(t.completedAt) >= start,
  );
  const events = todaysAgenda(input.events, now);
  const upcoming = events.filter((e) => e.allDay || Date.parse(e.end) > nowMs);

  const highlights: RoutineSummary['highlights'] = [];
  const seen = new Set<string>();
  const add = (t: Task, reason: 'overdue' | 'today' | 'priority') => {
    if (highlights.length < 3 && !seen.has(t.id)) {
      seen.add(t.id);
      highlights.push({ id: t.id, title: t.title, reason });
    }
  };
  [...overdue].sort((a, b) => Date.parse(a.dueAt as string) - Date.parse(b.dueAt as string)).forEach((t) => add(t, 'overdue'));
  [...dueToday].sort((a, b) => Date.parse(a.dueAt as string) - Date.parse(b.dueAt as string)).forEach((t) => add(t, 'today'));
  top.filter((t) => t.priority === 3).forEach((t) => add(t, 'priority'));

  const counts = {
    pending: top.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    eventsToday: upcoming.length,
    completedToday: completedToday.length,
    focusSessions: input.focus.sessions,
    focusMinutes: input.focus.minutes,
  };

  if (kind === 'morning') {
    const hour = now.getHours();
    const greeting = hour < 5 ? 'Madrugou!' : hour < 12 ? 'Bom dia!' : hour < 18 ? 'Boa tarde!' : 'Boa noite!';
    const lines: string[] = [];
    const parts: string[] = [];
    if (counts.dueToday + counts.overdue > 0) {
      parts.push(plural(counts.dueToday + counts.overdue, 'tarefa pede atenção', 'tarefas pedem atenção'));
    } else if (counts.pending > 0) {
      parts.push(plural(counts.pending, 'tarefa na lista', 'tarefas na lista'));
    }
    if (counts.eventsToday > 0) parts.push(plural(counts.eventsToday, 'evento', 'eventos'));
    lines.push(parts.length > 0 ? `Hoje: ${parts.join(' e ')}.` : 'Seu dia está livre. Que tal planejar algo?');
    if (counts.overdue > 0) lines.push(`${plural(counts.overdue, 'atrasada', 'atrasadas')}.`);
    const next = upcoming.find((e) => !e.allDay);
    if (next) lines.push(`Próximo: ${eventTimeLabel(next)} — ${next.title}`);
    const bubble =
      counts.dueToday + counts.overdue + counts.eventsToday > 0
        ? `${greeting} ${counts.dueToday + counts.overdue} tarefa(s), ${counts.eventsToday} evento(s).`
        : `${greeting} Dia livre por aqui.`;
    return { kind, greeting, bubble: bubble.slice(0, 56), lines, highlights, counts };
  }

  const greeting = 'Boa noite!';
  const lines: string[] = [];
  lines.push(
    counts.completedToday > 0
      ? `Você concluiu ${plural(counts.completedToday, 'tarefa', 'tarefas')} hoje.`
      : 'Hoje nenhuma tarefa foi concluída — tudo bem, amanhã é outro dia.',
  );
  if (counts.focusSessions > 0) {
    lines.push(`Foco: ${plural(counts.focusSessions, 'sessão', 'sessões')} (${counts.focusMinutes} min).`);
  }
  if (counts.overdue + counts.dueToday > 0) {
    lines.push(`Ficaram ${plural(counts.overdue + counts.dueToday, 'pendente', 'pendentes')} para hoje/atrasadas.`);
  } else if (counts.pending > 0) {
    lines.push(`${plural(counts.pending, 'tarefa continua', 'tarefas continuam')} na lista, sem pressa.`);
  } else {
    lines.push('Lista zerada. Descanse!');
  }
  const bubble =
    counts.completedToday > 0 ? `${greeting} ${counts.completedToday} concluída(s) hoje. Orgulho!` : `${greeting} Hora de descansar.`;
  return { kind, greeting, bubble: bubble.slice(0, 56), lines, highlights, counts };
}

/** Texto único (para o assistente): o resumo do cartão em linhas. */
export function routineText(summary: RoutineSummary): string {
  const extra = summary.highlights.map((h) => `• ${h.title}${h.reason === 'overdue' ? ' (atrasada)' : h.reason === 'today' ? ' (hoje)' : ' (prioridade alta)'}`);
  return [summary.greeting, ...summary.lines, ...extra].join('\n');
}
