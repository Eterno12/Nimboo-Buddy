import type { NotesRepository } from '../../shared/notes.ts';
import { validateNoteColor, validateNoteDoc } from '../../shared/notes.ts';
import type { TaskRepository } from '../../shared/tasks.ts';
import { validateDue, validateTitle } from '../../shared/tasks.ts';

/** Arquivo de backup/portabilidade: JSON simples e legível, sem nada que dependa do banco. */
export interface MochiExport {
  app: 'mochi-desktop-buddy';
  version: 1;
  exportedAt: string;
  tasks: { title: string; completed: boolean; dueAt: string | null }[];
  notes: { doc: unknown; color: string }[];
}

export interface ImportSummary {
  tasksAdded: number;
  tasksSkipped: number;
  notesAdded: number;
  notesSkipped: number;
  /** Itens do arquivo que não passaram na validação (ignorados). */
  invalid: number;
}

/** Limites do arquivo importado (evita travar o app com um arquivo gigante). */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_MAX_ITEMS = 5000;

export async function buildExport(
  tasks: TaskRepository,
  notes: NotesRepository,
  now: Date = new Date(),
): Promise<MochiExport> {
  const lists = await tasks.list();
  const summaries = await notes.list();
  const fullNotes: MochiExport['notes'] = [];
  for (const s of summaries) {
    const n = await notes.get(s.id);
    if (n.ok) fullNotes.push({ doc: n.value.doc, color: n.value.color });
  }
  return {
    app: 'mochi-desktop-buddy',
    version: 1,
    exportedAt: now.toISOString(),
    tasks: [...lists.active, ...lists.completed].map((t) => ({
      title: t.title,
      completed: t.completed,
      dueAt: t.dueAt,
    })),
    notes: fullNotes,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Lê o texto do arquivo; devolve `null` se não for um export do Mochi. */
export function parseExportFile(text: string): { tasks: unknown[]; notes: unknown[] } | null {
  if (text.length > IMPORT_MAX_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.app !== 'mochi-desktop-buddy' || data.version !== 1) return null;
  const tasks = Array.isArray(data.tasks) ? data.tasks.slice(0, IMPORT_MAX_ITEMS) : [];
  const notes = Array.isArray(data.notes) ? data.notes.slice(0, IMPORT_MAX_ITEMS) : [];
  return { tasks, notes };
}

/**
 * Importa SEM sobrescrever nada: tarefas já existentes (mesmo título e prazo, ativas) e notas de
 * conteúdo idêntico são puladas; o resto é criado. Cada item é validado pelas mesmas regras do app.
 */
export async function applyImport(
  file: { tasks: unknown[]; notes: unknown[] },
  tasks: TaskRepository,
  notes: NotesRepository,
): Promise<ImportSummary> {
  const summary: ImportSummary = { tasksAdded: 0, tasksSkipped: 0, notesAdded: 0, notesSkipped: 0, invalid: 0 };

  const existing = await tasks.list();
  const seenTasks = new Set([...existing.active, ...existing.completed].map((t) => `${t.title}|${t.dueAt ?? ''}`));
  for (const raw of file.tasks) {
    if (!isRecord(raw)) {
      summary.invalid += 1;
      continue;
    }
    const title = validateTitle(raw.title);
    const due = validateDue(raw.dueAt ?? null);
    if (!title.ok || !due.ok) {
      summary.invalid += 1;
      continue;
    }
    const key = `${title.value}|${due.value ?? ''}`;
    if (seenTasks.has(key)) {
      summary.tasksSkipped += 1;
      continue;
    }
    const created = await tasks.create(title.value, due.value);
    if (!created.ok) {
      summary.invalid += 1;
      continue;
    }
    seenTasks.add(key);
    if (raw.completed === true) await tasks.complete(created.value.id);
    summary.tasksAdded += 1;
  }

  const have = new Set<string>();
  for (const s of await notes.list()) {
    const n = await notes.get(s.id);
    if (n.ok) have.add(JSON.stringify(n.value.doc));
  }
  for (const raw of file.notes) {
    if (!isRecord(raw)) {
      summary.invalid += 1;
      continue;
    }
    const doc = validateNoteDoc(raw.doc);
    const color = validateNoteColor(raw.color);
    if (!doc.ok) {
      summary.invalid += 1;
      continue;
    }
    const key = JSON.stringify(doc.value);
    if (have.has(key)) {
      summary.notesSkipped += 1;
      continue;
    }
    const created = await notes.create({ doc: doc.value, color: color.ok ? color.value : undefined });
    if (!created.ok) {
      summary.invalid += 1;
      continue;
    }
    have.add(key);
    summary.notesAdded += 1;
  }
  return summary;
}
