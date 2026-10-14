import type { DatabaseSync } from 'node:sqlite';
import { buildWeek, type WeekStats } from '../../shared/stats.ts';

/** Lê as linhas da semana (com folga de 1 dia para o fuso) e deixa o agrupamento por dia local para a parte pura. */
export function queryWeek(db: DatabaseSync, now: Date = new Date()): WeekStats {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
  const focus = db
    .prepare(`SELECT completed_at AS at, minutes FROM focus_sessions WHERE kind = 'focus' AND completed_at >= ?`)
    .all(from) as { at: string; minutes: number }[];
  const tasks = (
    db.prepare(`SELECT completed_at AS at FROM tasks WHERE completed = 1 AND completed_at >= ?`).all(from) as {
      at: string;
    }[]
  ).map((r) => r.at);
  return buildWeek({ focus: focus.map((f) => ({ at: f.at, minutes: Number(f.minutes) })), tasks }, now);
}
