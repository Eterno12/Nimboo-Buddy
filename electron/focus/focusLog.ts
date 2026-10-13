import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FocusKind, FocusStats } from '../../shared/focus.ts';

/** Quanto tempo as sessões ficam guardadas (a estatística do dia só precisa do dia). */
export const FOCUS_LOG_RETENTION_DAYS = 400;

export interface FocusRecord {
  kind: FocusKind;
  minutes: number;
  /** Tarefa vinculada (id), se houver. */
  taskId: string | null;
  /** Instante em que a sessão terminou. */
  at: Date;
}

/**
 * Registro das sessões de foco/pausa CONCLUÍDAS (as canceladas não entram). Serve à estatística do
 * dia e prepara o terreno para histórico. Usa a mesma conexão SQLite das tarefas (tabela
 * `focus_sessions`, migração v2).
 */
export class FocusLog {
  private readonly db: DatabaseSync;
  private readonly newId: () => string;

  constructor(db: DatabaseSync, newId: () => string = randomUUID) {
    this.db = db;
    this.newId = newId;
  }

  record(entry: FocusRecord): void {
    if (!Number.isInteger(entry.minutes) || entry.minutes <= 0) return;
    this.db
      .prepare('INSERT INTO focus_sessions (id, kind, minutes, completed_at, task_id) VALUES (?, ?, ?, ?, ?)')
      .run(this.newId(), entry.kind, entry.minutes, entry.at.toISOString(), entry.taskId);
  }

  /** Focos concluídos no dia local de `now` (00:00 → 24:00 do horário do computador). */
  today(now: Date = new Date()): FocusStats {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS m
           FROM focus_sessions
          WHERE kind = 'focus' AND completed_at >= ? AND completed_at < ?`,
      )
      .get(start.toISOString(), end.toISOString()) as { n: number; m: number };
    return { sessions: Number(row.n), minutes: Number(row.m) };
  }

  /** Apaga registros antigos. Devolve quantos saíram. */
  purge(now: Date = new Date()): number {
    const cutoff = new Date(now.getTime() - FOCUS_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    return Number(this.db.prepare('DELETE FROM focus_sessions WHERE completed_at < ?').run(cutoff).changes);
  }
}
