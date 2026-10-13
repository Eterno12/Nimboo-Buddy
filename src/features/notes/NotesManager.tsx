import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTE_COLORS, type Note, type NoteSummary } from '../../../shared/notes';
import { useSettings } from '../settings/useSettings';
import { useTheme } from '../settings/useTheme';
import { NoteEditor } from './NoteEditor';
import { COLOR_LABEL } from './NoteWindow';
import { useNote } from './useNote';
import './notes.css';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" style={{ verticalAlign: '-2px' }}>
      <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Quanto tempo o "Desfazer" da exclusão fica à vista. */
const UNDO_MS = 8000;

function useNoteList(query: string) {
  const [items, setItems] = useState<NoteSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await window.mochi.notes.list(query.trim() || undefined);
    if (r.ok) {
      setItems(r.value);
      setError(null);
    } else {
      setError(r.error.message);
    }
  }, [query]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => window.mochi.notes.onChange(() => void reload()), [reload]);
  return { items, error, reload };
}

/** Janela de gerenciamento das notas: lista com busca à esquerda, editor à direita. */
export function NotesManager({ initialId }: { initialId: string | null }) {
  const { settings } = useSettings();
  const theme = useTheme(settings.theme);
  const [query, setQuery] = useState('');
  const { items, error: listError } = useNoteList(query);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [undo, setUndo] = useState<{ note: Note; timer: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { note, error: noteError, remote, saveDoc, patch } = useNote(selected);

  // Pedido de outra janela (ilha, nota flutuante): abre aquela nota.
  useEffect(() => window.mochi.notes.onOpen((id) => id && setSelected(id)), []);

  // Sem seleção (ou nota excluída): escolhe a mais recente da lista.
  const firstId = items[0]?.id ?? null;
  useEffect(() => {
    if (selected === null || (noteError && !note)) setSelected(firstId);
  }, [selected, firstId, noteError, note]);

  const create = async () => {
    setProblem(null);
    const r = await window.mochi.notes.create({});
    if (r.ok) {
      setQuery('');
      setSelected(r.value.id);
    } else {
      setProblem(r.error.message);
    }
  };

  const remove = async () => {
    if (!note) return;
    const copy = note;
    const r = await window.mochi.notes.remove(copy.id);
    if (!r.ok) {
      setProblem(r.error.message);
      return;
    }
    setSelected(null);
    if (undo) window.clearTimeout(undo.timer);
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS);
    setUndo({ note: copy, timer });
  };

  const restore = async () => {
    if (!undo) return;
    window.clearTimeout(undo.timer);
    const { note: copy } = undo;
    setUndo(null);
    const r = await window.mochi.notes.create({ doc: copy.doc, color: copy.color });
    if (r.ok) setSelected(r.value.id);
    else setProblem(r.error.message);
  };

  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void create();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="notes-app" data-theme={theme}>
      <aside className="notes-side" aria-label="Lista de notas">
        <div className="notes-side-head">
          <input
            ref={searchRef}
            className="notes-search"
            type="search"
            value={query}
            placeholder="Buscar nas notas"
            aria-label="Buscar nas notas"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="notes-new" onClick={() => void create()} title="Nova nota (Ctrl+N)">
            + Nova
          </button>
        </div>
        {(listError || problem) && (
          <p className="notes-problem" role="alert">
            {listError ?? problem}
          </p>
        )}
        <ul className="notes-list">
          {items.length === 0 && (
            <li className="notes-none">{query ? 'Nenhuma nota encontrada.' : 'Nenhuma nota ainda. Crie a primeira!'}</li>
          )}
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="notes-item"
                aria-current={n.id === selected}
                data-color={n.color}
                onClick={() => setSelected(n.id)}
              >
                <span className="notes-item-title">
                  {n.pinned && (
                    <span title="Está na área de trabalho" role="img" aria-label="Na área de trabalho">
                      <PinIcon />{' '}
                    </span>
                  )}
                  {n.title}
                </span>
                {n.preview && <span className="notes-item-preview">{n.preview}</span>}
                <span className="notes-item-date">{dateFormat.format(new Date(n.updatedAt))}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="notes-main" aria-label="Editor da nota">
        {note ? (
          <>
            <header className="notes-main-bar">
              <div className="notes-colors" role="radiogroup" aria-label="Cor do papel">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={note.color === c}
                    aria-label={COLOR_LABEL[c]}
                    title={COLOR_LABEL[c]}
                    className="note-dot-button"
                    data-color={c}
                    onClick={() => void patch({ color: c })}
                  />
                ))}
              </div>
              <div className="notes-main-actions">
                <button
                  type="button"
                  className="notes-action"
                  aria-pressed={note.pinned}
                  onClick={() => void patch({ pinned: !note.pinned })}
                  title={note.pinned ? 'Tirar da área de trabalho' : 'Deixar flutuando na área de trabalho'}
                >
                  <PinIcon /> {note.pinned ? 'Na área de trabalho' : 'Fixar na área de trabalho'}
                </button>
                <button type="button" className="notes-action notes-danger" onClick={() => void remove()}>
                  Excluir
                </button>
              </div>
            </header>
            <div className="notes-paper" data-color={note.color}>
              <NoteEditor key={note.id} initialDoc={note.doc} remote={remote} onChange={saveDoc} autoFocus />
            </div>
          </>
        ) : (
          <div className="notes-blank">
            <p>{selected === null && items.length === 0 ? 'Crie uma nota para começar.' : 'Escolha uma nota na lista.'}</p>
          </div>
        )}
        {undo && (
          <div className="notes-undo" role="status">
            <span>Nota excluída.</span>
            <button type="button" onClick={() => void restore()}>
              Desfazer
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
