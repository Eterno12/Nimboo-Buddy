import type { DatabaseSync } from 'node:sqlite';
import { SKIN_ID_RE } from '../../shared/skins.ts';
import { EMPTY_BOND, type BondDays, type BondState, type Stats } from '../../shared/achievements.ts';

export interface StoredBond {
  state: BondState;
  /** id → instante (ISO UTC) em que foi desbloqueada. */
  unlocked: Record<string, string>;
  affection: number;
  /** Ids dos acessórios comprados. */
  skins: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseStats(text: string | undefined): Stats {
  try {
    const raw = JSON.parse(text ?? '{}') as unknown;
    if (!isRecord(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (/^[a-z_]{1,32}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9) out[k] = v;
    }
    return out as Stats;
  } catch {
    return {};
  }
}

function parseDays(text: string | undefined): BondDays {
  try {
    const raw = JSON.parse(text ?? '{}') as unknown;
    if (!isRecord(raw)) return { firstDay: null, lastDay: null, characters: [] };
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const chars = Array.isArray(raw.characters)
      ? raw.characters.filter((c): c is string => typeof c === 'string' && /^[a-z]{2,20}$/.test(c)).slice(0, 32)
      : [];
    return { firstDay: day(raw.firstDay), lastDay: day(raw.lastDay), characters: chars };
  } catch {
    return { firstDay: null, lastDay: null, characters: [] };
  }
}

/** Contadores e conquistas no mesmo SQLite das tarefas (tolerante a dados corrompidos). */
export class SqliteBondStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  load(): StoredBond {
    const rows = this.db.prepare('SELECT key, value FROM bond_kv').all() as unknown as { key: string; value: string }[];
    const kv = new Map(rows.map((r) => [r.key, r.value]));
    const unlockedRows = this.db.prepare('SELECT id, unlocked_at FROM achievements').all() as unknown as {
      id: string;
      unlocked_at: string;
    }[];
    const unlocked: Record<string, string> = {};
    for (const r of unlockedRows) unlocked[r.id] = r.unlocked_at;
    const aff = Number(kv.get('affection'));
    const skinRows = this.db.prepare('SELECT id FROM skins_owned ORDER BY owned_at, id').all() as unknown as { id: string }[];
    const skins = skinRows.map((r) => r.id).filter((id) => SKIN_ID_RE.test(id)).slice(0, 64);
    return {
      state: kv.size === 0 ? EMPTY_BOND : { stats: parseStats(kv.get('stats')), days: parseDays(kv.get('days')) },
      unlocked,
      affection: Number.isFinite(aff) ? Math.min(1, Math.max(0, aff)) : 0.5,
      skins,
    };
  }

  save(state: BondState, affection: number): void {
    const upsert = this.db.prepare(
      'INSERT INTO bond_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    this.db.exec('BEGIN IMMEDIATE');
    try {
      upsert.run('stats', JSON.stringify(state.stats));
      upsert.run('days', JSON.stringify(state.days));
      upsert.run('affection', String(Math.min(1, Math.max(0, affection))));
      this.db.exec('COMMIT');
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** Garante uma linha por acessório comprado (compras nunca são desfeitas). */
  saveSkins(skins: readonly string[]): void {
    const insert = this.db.prepare("INSERT OR IGNORE INTO skins_owned (id, owned_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
    for (const id of skins) insert.run(id);
  }

  unlock(id: string, at: string): void {
    this.db.prepare('INSERT OR IGNORE INTO achievements (id, unlocked_at) VALUES (?, ?)').run(id, at);
  }
}
