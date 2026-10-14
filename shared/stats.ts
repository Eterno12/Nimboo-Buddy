/**
 * Estatísticas da semana: tarefas concluídas e foco por dia. Lógica pura (sem banco nem relógio fixo):
 * o main entrega as linhas e esta parte agrupa por dia LOCAL e resume.
 */

export interface DayStat {
  /** AAAA-MM-DD (dia local). */
  day: string;
  focusMinutes: number;
  focusSessions: number;
  tasksCompleted: number;
}

export interface WeekStats {
  /** 7 dias, do mais antigo ao de hoje (último). */
  days: DayStat[];
  totals: { focusMinutes: number; focusSessions: number; tasksCompleted: number };
  /** Dia com mais foco (minutos > 0), ou `null` se não houve foco. */
  bestFocusDay: string | null;
  /** Média de foco por dia com foco, em minutos (arredondada). */
  avgFocusMinutes: number;
  /** Dias da semana com alguma atividade (foco ou tarefa), de 0 a 7. */
  activeDays: number;
}

const p2 = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

/** As últimas `count` datas locais terminando em `now`, da mais antiga à mais recente. */
export function lastDays(now: Date, count = 7): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  return out;
}

export interface StatRows {
  /** Sessões de foco concluídas: instante ISO e minutos. */
  focus: { at: string; minutes: number }[];
  /** Instantes ISO em que tarefas foram concluídas. */
  tasks: string[];
}

export function buildWeek(rows: StatRows, now: Date): WeekStats {
  const keys = lastDays(now, 7);
  const byDay = new Map<string, DayStat>(
    keys.map((day) => [day, { day, focusMinutes: 0, focusSessions: 0, tasksCompleted: 0 }]),
  );
  for (const f of rows.focus) {
    const d = new Date(f.at);
    if (Number.isNaN(d.getTime())) continue;
    const s = byDay.get(dayKey(d));
    if (!s || !Number.isFinite(f.minutes) || f.minutes <= 0) continue;
    s.focusMinutes += f.minutes;
    s.focusSessions += 1;
  }
  for (const at of rows.tasks) {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) continue;
    const s = byDay.get(dayKey(d));
    if (s) s.tasksCompleted += 1;
  }
  const days = keys.map((k) => byDay.get(k) as DayStat);
  const totals = days.reduce(
    (t, d) => ({
      focusMinutes: t.focusMinutes + d.focusMinutes,
      focusSessions: t.focusSessions + d.focusSessions,
      tasksCompleted: t.tasksCompleted + d.tasksCompleted,
    }),
    { focusMinutes: 0, focusSessions: 0, tasksCompleted: 0 },
  );
  let best: DayStat | null = null;
  for (const d of days) if (d.focusMinutes > 0 && (!best || d.focusMinutes > best.focusMinutes)) best = d;
  const withFocus = days.filter((d) => d.focusMinutes > 0).length;
  return {
    days,
    totals,
    bestFocusDay: best?.day ?? null,
    avgFocusMinutes: withFocus === 0 ? 0 : Math.round(totals.focusMinutes / withFocus),
    activeDays: days.filter((d) => d.focusMinutes > 0 || d.tasksCompleted > 0).length,
  };
}

/** "1 h 05" / "45 min" / "0 min". */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${p2(m % 60)}`;
}
