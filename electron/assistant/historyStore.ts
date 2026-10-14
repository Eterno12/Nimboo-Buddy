import type { DatabaseSync } from 'node:sqlite';
import { HISTORY_LIMIT, HISTORY_TEXT_MAX, type HistoryEntry } from '../../shared/assistantApi.ts';

type Row = { role: string; text: string; label: string | null; url: string | null; at: string };

/** Histórico da conversa com o assistente no mesmo SQLite (migração v8). Só texto; no máximo 200 mensagens. */
export class AssistantHistory {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(db: DatabaseSync, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  list(): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT role, text, label, url, at FROM assistant_history ORDER BY seq DESC LIMIT ?')
      .all(HISTORY_LIMIT) as Row[];
    return rows.reverse().map((r) => ({
      role: r.role === 'user' ? 'user' : 'assistant',
      text: r.text,
      ...(r.label ? { source: { label: r.label, ...(r.url ? { url: r.url } : {}) } } : {}),
      at: r.at,
    }));
  }

  /** Entradas inválidas são ignoradas; devolve quantas foram guardadas. */
  add(entries: unknown): number {
    if (!Array.isArray(entries)) return 0;
    const insert = this.db.prepare('INSERT INTO assistant_history (role, text, label, url, at) VALUES (?, ?, ?, ?, ?)');
    let saved = 0;
    this.db.exec('BEGIN');
    try {
      for (const raw of entries.slice(0, 20)) {
        if (typeof raw !== 'object' || raw === null) continue;
        const e = raw as { role?: unknown; text?: unknown; source?: { label?: unknown; url?: unknown } };
        if (e.role !== 'user' && e.role !== 'assistant') continue;
        if (typeof e.text !== 'string') continue;
        const text = e.text.trim().slice(0, HISTORY_TEXT_MAX);
        if (!text) continue;
        const label = typeof e.source?.label === 'string' ? e.source.label.slice(0, 120) : null;
        const url = label && typeof e.source?.url === 'string' && /^https?:\/\//.test(e.source.url) ? e.source.url.slice(0, 500) : null;
        insert.run(e.role, text, label, url, this.now().toISOString());
        saved += 1;
      }
      this.db
        .prepare('DELETE FROM assistant_history WHERE seq <= (SELECT MAX(seq) FROM assistant_history) - ?')
        .run(HISTORY_LIMIT);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return saved;
  }

  clear(): void {
    this.db.exec('DELETE FROM assistant_history');
  }
}
