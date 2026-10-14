/**
 * Modelo e contratos das notas. Independente de SQLite, Electron e React: o documento é o JSON do
 * editor (formato do ProseMirror), validado e "limpo" por lista de permissões antes de ser guardado.
 */

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'lilac', 'white'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const DEFAULT_NOTE_COLOR: NoteColor = 'yellow';

/** Tamanho máximo do documento serializado (bytes). */
export const NOTE_DOC_MAX_BYTES = 200_000;
/** Limite de notas guardadas. */
export const NOTE_LIMIT = 2000;
/** Título derivado (primeira linha), em caracteres. */
export const NOTE_TITLE_MAX = 120;
export const NOTE_PREVIEW_MAX = 140;
export const NOTE_UNTITLED = 'Nota sem título';

const MAX_DEPTH = 12;
const MAX_NODES = 20_000;
const MAX_TEXT_CHARS = 100_000;

/** Nó do documento (estrutura do ProseMirror em JSON). */
export interface NoteNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NoteNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}
export interface NoteDoc {
  type: 'doc';
  content: NoteNode[];
}

export interface NoteBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Note {
  id: string;
  /** Primeira linha do texto (derivada). */
  title: string;
  doc: NoteDoc;
  color: NoteColor;
  /** Aberta como nota flutuante na área de trabalho. */
  pinned: boolean;
  /** Última posição/tamanho da janela flutuante. */
  bounds: NoteBounds | null;
  createdAt: string;
  updatedAt: string;
  /** Tarefa a que esta nota pertence (anotações da tarefa) ou `null`. */
  taskId: string | null;
  /** Evento da agenda a que esta nota está anexada (pauta) ou `null`. */
  eventRef: string | null;
}

/** O que a lista mostra (sem o documento inteiro). */
export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  color: NoteColor;
  pinned: boolean;
  updatedAt: string;
  taskId: string | null;
  eventRef: string | null;
}

export type NoteErrorCode =
  | 'invalid_id'
  | 'invalid_doc'
  | 'too_large'
  | 'invalid_color'
  | 'invalid_bounds'
  | 'not_found'
  | 'limit_reached'
  | 'storage';

export interface NoteError {
  code: NoteErrorCode;
  message: string;
}

export type NoteResult<T> = { ok: true; value: T } | { ok: false; error: NoteError };

export const noteOk = <T>(value: T): NoteResult<T> => ({ ok: true, value });
export const noteFail = <T = never>(code: NoteErrorCode, message: string): NoteResult<T> => ({
  ok: false,
  error: { code, message },
});

export interface NoteCreateInput {
  doc?: unknown;
  color?: unknown;
  /** Cria (ou devolve, se já existe) a nota desta tarefa. */
  taskId?: unknown;
  /** Cria (ou devolve, se já existe) a nota deste evento da agenda. */
  eventRef?: unknown;
}

export interface NoteUpdatePatch {
  doc?: unknown;
  color?: unknown;
  pinned?: unknown;
  bounds?: unknown;
}

/** Mudanças confirmadas (o main as usa para abrir/fechar janelas flutuantes). */
export type NoteChange =
  | { type: 'created'; id: string }
  | { type: 'updated'; id: string; fields: ('doc' | 'color' | 'pinned' | 'bounds')[] }
  | { type: 'removed'; id: string };

export interface NotesRepository {
  list(query?: string): Promise<NoteSummary[]>;
  get(id: string): Promise<NoteResult<Note>>;
  create(input?: NoteCreateInput): Promise<NoteResult<Note>>;
  update(id: string, patch: NoteUpdatePatch): Promise<NoteResult<Note>>;
  remove(id: string): Promise<NoteResult<null>>;
  /** Notas abertas como flutuantes (para reabri-las ao iniciar o app). */
  pinned(): Promise<Note[]>;
}

/** API de notas exposta ao renderer (`window.mochi.notes`). */
export interface NotesApi {
  list(query?: string): Promise<NoteResult<NoteSummary[]>>;
  get(id: string): Promise<NoteResult<Note>>;
  create(input?: NoteCreateInput): Promise<NoteResult<Note>>;
  update(id: string, patch: NoteUpdatePatch): Promise<NoteResult<Note>>;
  remove(id: string): Promise<NoteResult<null>>;
  /** Abre (ou traz à frente) a janela de gerenciamento das notas, opcionalmente em uma nota. */
  openManager(id?: string): void;
  /** Alguma nota mudou (em qualquer janela); `fields` diz o que mudou (ex.: só a posição da janela). */
  onChange(listener: (change: NoteChange) => void): () => void;
  /** Pede à janela de gerenciamento que abra uma nota (ex.: vinda da ilha). */
  onOpen(listener: (id: string | null) => void): () => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isNoteId = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);

/** Referência de vínculo (id de evento da agenda): texto curto, sem caracteres de controle. */
export function isLinkRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  // eslint-disable-next-line no-control-regex
  return text.length > 0 && text.length <= 300 && !/[\u0000-\u001f\u007f]/.test(text);
}

export const isNoteColor = (value: unknown): value is NoteColor =>
  typeof value === 'string' && (NOTE_COLORS as readonly string[]).includes(value);

export function validateNoteColor(input: unknown): NoteResult<NoteColor> {
  return isNoteColor(input) ? noteOk(input) : noteFail('invalid_color', 'Cor de nota inválida.');
}

export function validateBounds(input: unknown): NoteResult<NoteBounds | null> {
  if (input === null || input === undefined) return noteOk(null);
  if (typeof input !== 'object' || Array.isArray(input)) return noteFail('invalid_bounds', 'Posição inválida.');
  const r = input as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null;
  const x = num(r.x, -20_000, 20_000);
  const y = num(r.y, -20_000, 20_000);
  const width = num(r.width, 160, 2400);
  const height = num(r.height, 120, 2400);
  if (x === null || y === null || width === null || height === null) {
    return noteFail('invalid_bounds', 'Posição ou tamanho inválidos.');
  }
  return noteOk({ x, y, width, height });
}

// ---------------------------------------------------------------------------
// Documento: lista de permissões (nós, marcas e atributos). Tudo fora dela é recusado.
// ---------------------------------------------------------------------------

const ALIGN = ['left', 'center', 'right', 'justify'] as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const LANG = /^[a-z0-9+#-]{1,20}$/i;
const LINK_MAX = 2000;

const INLINE = new Set(['text', 'hardBreak']);
const BLOCKS = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'codeBlock',
  'horizontalRule',
]);

/** O que cada nó pode conter (nomes de tipos). */
const CHILDREN: Record<string, 'inline' | 'block' | 'listItem' | 'taskItem' | 'text' | 'none'> = {
  doc: 'block',
  paragraph: 'inline',
  heading: 'inline',
  blockquote: 'block',
  bulletList: 'listItem',
  orderedList: 'listItem',
  taskList: 'taskItem',
  listItem: 'block',
  taskItem: 'block',
  codeBlock: 'text',
  horizontalRule: 'none',
  hardBreak: 'none',
  text: 'none',
};

type Mark = { type: string; attrs?: Record<string, unknown> };

function safeHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > LINK_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
}

function cleanMark(raw: unknown): Mark | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as { type?: unknown; attrs?: Record<string, unknown> };
  switch (m.type) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
    case 'code':
      return { type: m.type };
    case 'link': {
      const href = safeHref(m.attrs?.href);
      return href ? { type: 'link', attrs: { href } } : null;
    }
    case 'highlight':
    case 'textStyle': {
      const color = m.attrs?.color;
      if (typeof color === 'string' && HEX_COLOR.test(color)) return { type: m.type, attrs: { color } };
      return m.type === 'highlight' ? { type: 'highlight' } : null;
    }
    default:
      return null;
  }
}

interface Budget {
  nodes: number;
  chars: number;
}

class DocError extends Error {}

function cleanNode(raw: unknown, parent: string, depth: number, budget: Budget): NoteNode | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new DocError('nó inválido');
  if (depth > MAX_DEPTH) throw new DocError('documento muito aninhado');
  if (++budget.nodes > MAX_NODES) throw new DocError('documento grande demais');
  const n = raw as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown; marks?: unknown; text?: unknown };
  const type = n.type;
  if (typeof type !== 'string' || !Object.hasOwn(CHILDREN, type) || type === 'doc') throw new DocError(`nó não permitido: ${String(type)}`);

  const allowed = CHILDREN[parent];
  const okHere =
    (allowed === 'inline' && INLINE.has(type)) ||
    (allowed === 'block' && BLOCKS.has(type)) ||
    (allowed === 'listItem' && type === 'listItem') ||
    (allowed === 'taskItem' && type === 'taskItem') ||
    (allowed === 'text' && type === 'text');
  if (!okHere) throw new DocError(`${type} não cabe em ${parent}`);

  if (type === 'text') {
    if (typeof n.text !== 'string') throw new DocError('texto inválido');
    budget.chars += n.text.length;
    if (budget.chars > MAX_TEXT_CHARS) throw new DocError('texto longo demais');
    if (n.text.length === 0) return null;
    const marks: Mark[] = [];
    if (Array.isArray(n.marks)) {
      for (const m of n.marks) {
        const c = cleanMark(m);
        if (c && !marks.some((x) => x.type === c.type)) marks.push(c);
      }
    }
    return marks.length > 0 ? { type, text: n.text, marks } : { type, text: n.text };
  }

  const out: NoteNode = { type };
  const attrs: Record<string, unknown> = {};
  const a = n.attrs ?? {};
  if (type === 'paragraph' || type === 'heading') {
    if ((ALIGN as readonly unknown[]).includes(a.textAlign)) attrs.textAlign = a.textAlign;
  }
  if (type === 'heading') {
    const level = a.level;
    attrs.level = level === 1 || level === 2 || level === 3 ? level : 2;
  }
  if (type === 'orderedList') {
    const start = a.start;
    if (typeof start === 'number' && Number.isInteger(start) && start >= 1 && start <= 9999) attrs.start = start;
  }
  if (type === 'taskItem') attrs.checked = a.checked === true;
  if (type === 'codeBlock' && typeof a.language === 'string' && LANG.test(a.language)) attrs.language = a.language;
  if (Object.keys(attrs).length > 0) out.attrs = attrs;

  if (CHILDREN[type] !== 'none') {
    const content = Array.isArray(n.content) ? n.content : [];
    const cleaned: NoteNode[] = [];
    for (const child of content) {
      const c = cleanNode(child, type, depth + 1, budget);
      if (c) cleaned.push(c);
    }
    if (cleaned.length > 0) out.content = cleaned;
  }
  return out;
}

/** Documento vazio (um parágrafo vazio). */
export const emptyNoteDoc = (): NoteDoc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

/**
 * Valida e normaliza o documento do editor. Devolve uma CÓPIA contendo só nós, marcas e atributos
 * permitidos (cores só em hexadecimal, links só http/https/mailto), com limites de profundidade, nós,
 * texto e tamanho serializado.
 */
export function validateNoteDoc(input: unknown): NoteResult<NoteDoc> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return noteFail('invalid_doc', 'O conteúdo da nota é inválido.');
  }
  const raw = input as { type?: unknown; content?: unknown };
  if (raw.type !== 'doc') return noteFail('invalid_doc', 'O conteúdo da nota é inválido.');
  try {
    const budget: Budget = { nodes: 0, chars: 0 };
    const content: NoteNode[] = [];
    for (const child of Array.isArray(raw.content) ? raw.content : []) {
      const c = cleanNode(child, 'doc', 1, budget);
      if (c) content.push(c);
    }
    const doc: NoteDoc = { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
    if (JSON.stringify(doc).length > NOTE_DOC_MAX_BYTES) {
      return noteFail('too_large', 'A nota ficou grande demais.');
    }
    return noteOk(doc);
  } catch (error) {
    if (error instanceof DocError) return noteFail('invalid_doc', 'O conteúdo da nota é inválido.');
    throw error;
  }
}

/** Texto simples do documento: um bloco por linha (listas e tarefas viram linhas). */
export function noteLines(doc: NoteDoc): string[] {
  const lines: string[] = [];
  const inline = (n: NoteNode): string =>
    n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? ' ' : (n.content ?? []).map(inline).join('');
  const walk = (n: NoteNode): void => {
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') {
      const text = inline(n).replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
      return;
    }
    for (const child of n.content ?? []) walk(child);
  };
  for (const n of doc.content) walk(n);
  return lines;
}

const clip = (text: string, max: number): string => {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
};

/** Título, prévia e texto de busca derivados do documento. */
export function describeNote(doc: NoteDoc): { title: string; preview: string; plain: string } {
  const lines = noteLines(doc);
  const title = lines.length > 0 ? clip(lines[0], NOTE_TITLE_MAX) : NOTE_UNTITLED;
  const preview = clip(lines.slice(1).join(' · '), NOTE_PREVIEW_MAX);
  return { title, preview, plain: lines.join('\n') };
}

/** Texto de busca: minúsculas e sem acentos (a busca do SQLite só ignora maiúsculas ASCII). */
export function searchText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Texto para o LIKE do SQLite: escapa `%`, `_` e a própria barra. */
export function likePattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
