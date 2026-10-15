import { useCallback, useEffect, useState } from 'react';
import { NOTE_COLORS, NOTE_UNTITLED, type Note, type NoteColor, type NoteDoc, type NoteSummary } from '../../../shared/notes';
import { NoteEditor } from '../../../src/features/notes/NoteEditor';
import type { Core } from '../core';
import { Icon } from '../ui/Icon';
import '../../../src/features/notes/notes.css';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const COLOR_NAME: Record<NoteColor, string> = { yellow: 'Amarela', pink: 'Rosa', blue: 'Azul', green: 'Verde', lilac: 'Lilás', white: 'Branca' };

/** Lista de notas com busca; abre o editor em tela cheia. */
export function NotesScreen({ core }: { core: Core }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<NoteSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(await core.notes.list(query));
  }, [core, query]);

  useEffect(() => {
    void load();
    return core.subscribe(() => void load());
  }, [core, load]);

  const create = async () => {
    const r = await core.notes.create({});
    if (r.ok) setOpenId(r.value.id);
  };

  if (openId) return <NoteEditorScreen core={core} id={openId} onClose={() => setOpenId(null)} />;

  return (
    <div className="screen" data-testid="screen-notes">
      <header className="screen-head">
        <h1>Notas</h1>
      </header>
      <input
        type="search"
        className="search"
        placeholder="Buscar nas notas"
        aria-label="Buscar nas notas"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="notes-search"
      />

      <ul className="note-list" data-testid="notes">
        {items.map((n) => (
          <li key={n.id}>
            <button type="button" className="note-item" data-color={n.color} data-testid="note-item" onClick={() => setOpenId(n.id)}>
              <span className="note-item-title">{n.title || NOTE_UNTITLED}</span>
              {n.preview && <span className="note-item-preview">{n.preview}</span>}
              <span className="note-item-date">{dateFormat.format(new Date(n.updatedAt))}</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <div className="empty-card">
          <p>{query ? 'Nenhuma nota encontrada.' : 'Nenhuma nota ainda. Toque em + para escrever.'}</p>
        </div>
      )}

      <button type="button" className="fab" aria-label="Nova nota" data-testid="fab-note" onClick={() => void create()}>
        <Icon name="plus" size={26} />
      </button>
    </div>
  );
}

function NoteEditorScreen({ core, id, onClose }: { core: Core; id: string; onClose(): void }) {
  const [note, setNote] = useState<Note | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    void core.notes.get(id).then((r) => {
      if (!alive) return;
      if (r.ok) setNote(r.value);
      else onClose();
    });
    return () => {
      alive = false;
    };
  }, [core, id, onClose]);

  // Voltar do Android fecha o editor (e salva: o editor grava ao desmontar).
  useEffect(() => {
    history.pushState({ note: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [onClose]);

  if (!note) return <div className="screen" />;

  const save = (doc: NoteDoc) => void core.notes.update(id, { doc });
  const setColor = async (color: NoteColor) => {
    const r = await core.notes.update(id, { color });
    if (r.ok) setNote(r.value);
  };

  return (
    <div className="note-screen" data-color={note.color} data-testid="note-screen">
      <header className="note-bar">
        <button type="button" className="icon-btn" aria-label="Voltar" data-testid="note-back" onClick={() => history.back()}>
          <Icon name="chevron" size={22} />
        </button>
        <div className="note-colors" role="radiogroup" aria-label="Cor da nota">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={note.color === c}
              aria-label={COLOR_NAME[c]}
              className="note-color"
              data-color={c}
              onClick={() => void setColor(c)}
            />
          ))}
        </div>
        <button type="button" className="icon-btn" aria-label="Excluir nota" data-testid="note-delete" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={20} />
        </button>
      </header>

      <div className="note-body">
        <NoteEditor initialDoc={note.doc} onChange={save} autoFocus={note.title === ''} />
      </div>

      {confirmDelete && (
        <div className="sheet-root">
          <button type="button" className="sheet-backdrop" aria-label="Cancelar" onClick={() => setConfirmDelete(false)} />
          <div className="sheet" role="alertdialog" aria-label="Excluir nota">
            <div className="sheet-grip" aria-hidden="true" />
            <h2>Excluir esta nota?</h2>
            <p className="muted">Ela some deste aparelho e dos outros conectados.</p>
            <div className="sheet-actions">
              <button type="button" className="btn-soft" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger"
                data-testid="note-delete-confirm"
                onClick={() => {
                  void core.notes.remove(id).then(() => history.back());
                }}
              >
                <Icon name="trash" size={18} /> Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
