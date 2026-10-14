import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_NOTE_COLOR,
  NOTE_LIMIT,
  describeNote,
  emptyNoteDoc,
  isNoteId,
  isLinkRef,
  likePattern,
  noteFail,
  noteOk,
  searchText,
  validateBounds,
  validateNoteColor,
  validateNoteDoc,
  type Note,
  type NoteBounds,
  type NoteChange,
  type NoteColor,
  type NoteCreateInput,
  type NoteDoc,
  type NoteResult,
  type NotesRepository,
  type NoteSummary,
  type NoteUpdatePatch,
} from '../../shared/notes.ts';

export interface SqliteNotesRepositoryOptions {
  now?: () => Date;
  newId?: () => string;
  onChange?: (change: NoteChange) => void;
}

interface Row {
  id: string;
  title: string;
  preview: string;
  plain: string;
  doc: string;
  color: string;
  pinned: number;
  win_x: number | null;
  win_y: number | null;
  win_w: number | null;
  win_h: number | null;
  created_at: string;
  updated_at: string;
  task_id: string | null;
  event_ref: string | null;
}

const toBounds = (r: Row): NoteBounds | null =>
  r.win_x === null || r.win_y === null || r.win_w === null || r.win_h === null
    ? null
    : { x: r.win_x, y: r.win_y, width: r.win_w, height: r.win_h };

function parseDoc(text: string): NoteDoc {
  try {
    const checked = validateNoteDoc(JSON.parse(text));
    if (checked.ok) return checked.value;
  } catch {
    /* documento corrompido: abre vazio em vez de quebrar a lista */
  }
  return emptyNoteDoc();
}

const toNote = (r: Row): Note => ({
  id: r.id,
  title: r.title,
  doc: parseDoc(r.doc),
  color: (validateNoteColor(r.color).ok ? r.color : DEFAULT_NOTE_COLOR) as NoteColor,
  pinned: r.pinned === 1,
  bounds: toBounds(r),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  taskId: r.task_id ?? null,
  eventRef: r.event_ref ?? null,
});

const toSummary = (r: Row): NoteSummary => ({
  id: r.id,
  title: r.title,
  preview: r.preview,
  color: (validateNoteColor(r.color).ok ? r.color : DEFAULT_NOTE_COLOR) as NoteColor,
  pinned: r.pinned === 1,
  updatedAt: r.updated_at,
  taskId: r.task_id ?? null,
  eventRef: r.event_ref ?? null,
});

/**
 * Notas em SQLite local (mesmo arquivo e mesmas garantias das tarefas: transações `BEGIN IMMEDIATE`,
 * UUID do cliente, datas UTC). O documento é sempre validado/normalizado antes de gravar e ao ler.
 */
export class SqliteNotesRepository implements NotesRepository {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly onChange: (change: NoteChange) => void;

  constructor(db: DatabaseSync, options: SqliteNotesRepositoryOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
    this.onChange = options.onChange ?? (() => {});
  }

  private notify(change: NoteChange): void {
    try {
      this.onChange(change);
    } catch (error) {
      console.error('Falha ao notificar a mudança de notas (a operação foi concluída):', error);
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private guard<T>(fn: () => NoteResult<T>): NoteResult<T> {
    try {
      return fn();
    } catch (error) {
      console.error('Falha no armazenamento de notas:', error);
      return noteFail('storage', 'Não foi possível acessar as notas salvas.');
    }
  }

  async list(query?: string): Promise<NoteSummary[]> {
    const text = typeof query === 'string' ? query.trim().slice(0, 100) : '';
    const rows = (
      text
        ? this.db
            .prepare(
              "SELECT * FROM notes WHERE plain LIKE ? ESCAPE '\\' ORDER BY updated_at DESC, id ASC LIMIT 500",
            )
            .all(likePattern(searchText(text)))
        : this.db.prepare('SELECT * FROM notes ORDER BY updated_at DESC, id ASC LIMIT 500').all()
    ) as unknown as Row[];
    return rows.map(toSummary);
  }

  async get(id: string): Promise<NoteResult<Note>> {
    if (!isNoteId(id)) return noteFail('invalid_id', 'Identificador de nota inválido.');
    return this.guard(() => {
      const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as unknown as Row | undefined;
      return row ? noteOk(toNote(row)) : noteFail('not_found', 'A nota não existe mais.');
    });
  }

  async pinned(): Promise<Note[]> {
    const rows = this.db.prepare('SELECT * FROM notes WHERE pinned = 1 ORDER BY updated_at DESC').all() as unknown as Row[];
    return rows.map(toNote);
  }

  async create(input: NoteCreateInput = {}): Promise<NoteResult<Note>> {
    const doc = input.doc === undefined ? noteOk(emptyNoteDoc()) : validateNoteDoc(input.doc);
    if (!doc.ok) return doc;
    const color = input.color === undefined ? noteOk(DEFAULT_NOTE_COLOR) : validateNoteColor(input.color);
    if (!color.ok) return color;
    const meta = describeNote(doc.value);
    let taskId: string | null = null;
    if (input.taskId !== undefined && input.taskId !== null) {
      if (!isNoteId(input.taskId)) return noteFail('invalid_id', 'Identificador de tarefa inválido.');
      taskId = input.taskId;
    }
    let eventRef: string | null = null;
    if (input.eventRef !== undefined && input.eventRef !== null) {
      if (!isLinkRef(input.eventRef)) return noteFail('invalid_id', 'Evento inválido.');
      eventRef = input.eventRef.trim();
    }
    const result = this.guard(() =>
      this.transaction((): NoteResult<Note> & { existing?: boolean } => {
        // Idempotente por vínculo: a mesma tarefa/evento devolve a nota que já existe.
        if (taskId !== null || eventRef !== null) {
          const found = this.db
            .prepare('SELECT * FROM notes WHERE (task_id IS NOT NULL AND task_id = ?) OR (event_ref IS NOT NULL AND event_ref = ?) LIMIT 1')
            .get(taskId, eventRef) as unknown as Row | undefined;
          if (found) return { ...noteOk(toNote(found)), existing: true };
        }
        const total = this.db.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number };
        if (total.n >= NOTE_LIMIT) return noteFail('limit_reached', 'Há notas demais guardadas. Exclua algumas.');
        const at = this.now().toISOString();
        const row: Row = {
          id: this.newId(),
          title: meta.title,
          preview: meta.preview,
          plain: searchText(meta.plain),
          doc: JSON.stringify(doc.value),
          color: color.value,
          pinned: 0,
          win_x: null,
          win_y: null,
          win_w: null,
          win_h: null,
          created_at: at,
          updated_at: at,
          task_id: taskId,
          event_ref: eventRef,
        };
        this.db
          .prepare(
            'INSERT INTO notes (id, title, preview, plain, doc, color, pinned, created_at, updated_at, task_id, event_ref) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)',
          )
          .run(
            row.id,
            row.title,
            row.preview,
            row.plain,
            row.doc,
            row.color,
            row.created_at,
            row.updated_at,
            row.task_id,
            row.event_ref,
          );
        return noteOk(toNote(row));
      }),
    );
    if (!result.ok) return result;
    const { existing, ...plain } = result as NoteResult<Note> & { existing?: boolean };
    if (!existing) this.notify({ type: 'created', id: result.value.id });
    return plain as NoteResult<Note>;
  }

  async update(id: string, patch: NoteUpdatePatch): Promise<NoteResult<Note>> {
    if (!isNoteId(id)) return noteFail('invalid_id', 'Identificador de nota inválido.');
    if (typeof patch !== 'object' || patch === null) return noteFail('invalid_doc', 'Alteração inválida.');

    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const fields: ('doc' | 'color' | 'pinned' | 'bounds')[] = [];
    const has = (k: keyof NoteUpdatePatch) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;

    if (has('doc')) {
      const doc = validateNoteDoc(patch.doc);
      if (!doc.ok) return doc;
      const meta = describeNote(doc.value);
      sets.push('doc = ?', 'title = ?', 'preview = ?', 'plain = ?');
      values.push(JSON.stringify(doc.value), meta.title, meta.preview, searchText(meta.plain));
      fields.push('doc');
    }
    if (has('color')) {
      const color = validateNoteColor(patch.color);
      if (!color.ok) return color;
      sets.push('color = ?');
      values.push(color.value);
      fields.push('color');
    }
    if (has('pinned')) {
      if (typeof patch.pinned !== 'boolean') return noteFail('invalid_doc', 'Alteração inválida.');
      sets.push('pinned = ?');
      values.push(patch.pinned ? 1 : 0);
      fields.push('pinned');
    }
    if (has('bounds')) {
      const bounds = validateBounds(patch.bounds);
      if (!bounds.ok) return bounds;
      const b = bounds.value;
      sets.push('win_x = ?', 'win_y = ?', 'win_w = ?', 'win_h = ?');
      values.push(b?.x ?? null, b?.y ?? null, b?.width ?? null, b?.height ?? null);
      fields.push('bounds');
    }
    if (sets.length === 0) return this.get(id);

    const result = this.guard(() =>
      this.transaction((): NoteResult<Note> => {
        const existing = this.db.prepare('SELECT 1 AS x FROM notes WHERE id = ?').get(id);
        if (!existing) return noteFail('not_found', 'A nota não existe mais.');
        // Mover/redimensionar a janela não "atualiza" a nota (a lista ordena por edição).
        const touch = fields.some((f) => f !== 'bounds' && f !== 'pinned');
        if (touch) {
          sets.push('updated_at = ?');
          values.push(this.now().toISOString());
        }
        this.db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
        const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as unknown as Row;
        return noteOk(toNote(row));
      }),
    );
    if (result.ok) this.notify({ type: 'updated', id, fields });
    return result;
  }

  async remove(id: string): Promise<NoteResult<null>> {
    if (!isNoteId(id)) return noteFail('invalid_id', 'Identificador de nota inválido.');
    const result = this.guard(() =>
      this.transaction((): NoteResult<null> => {
        const r = this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
        return Number(r.changes) === 0 ? noteFail('not_found', 'A nota não existe mais.') : noteOk(null);
      }),
    );
    if (result.ok) this.notify({ type: 'removed', id });
    return result;
  }
}
