import { useState } from 'react';
import { NOTE_COLORS, type NoteColor } from '../../../shared/notes';
import { NoteEditor } from './NoteEditor';
import { useNote } from './useNote';
import './notes.css';

export const COLOR_LABEL: Record<NoteColor, string> = {
  yellow: 'Amarelo',
  pink: 'Rosa',
  blue: 'Azul',
  green: 'Verde',
  lilac: 'Lilás',
  white: 'Branco',
};

/**
 * Nota flutuante: uma folha de papel solta na área de trabalho (janela comum, sem borda; NÃO fica
 * sobre os outros aplicativos). O cabeçalho arrasta a janela; "Soltar" fecha a janela mas guarda a nota.
 */
export function NoteWindow({ id }: { id: string }) {
  const { note, error, remote, saveDoc, patch } = useNote(id);
  const [tools, setTools] = useState(false);
  const [colors, setColors] = useState(false);

  if (!note) {
    return (
      <main className="note-sheet" data-color="yellow">
        <p className="note-empty">{error ?? 'Carregando…'}</p>
      </main>
    );
  }

  return (
    <main className="note-sheet" data-color={note.color} data-float="true">
      <header className="note-sheet-bar">
        <span className="note-grip" aria-hidden="true" />
        <div className="note-sheet-actions">
          <button
            type="button"
            className="note-bar-button"
            aria-pressed={tools}
            aria-label="Formatação"
            title="Formatação"
            onClick={() => setTools((v) => !v)}
          >
            Aa
          </button>
          <button
            type="button"
            className="note-bar-button"
            aria-pressed={colors}
            aria-label="Cor do papel"
            title="Cor do papel"
            onClick={() => setColors((v) => !v)}
          >
            <span className="note-dot" data-color={note.color} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="note-bar-button"
            aria-label="Abrir na janela de notas"
            title="Abrir na janela de notas"
            onClick={() => window.mochi.notes.openManager(note.id)}
          >
            ↗
          </button>
          <button
            type="button"
            className="note-bar-button note-unpin"
            aria-label="Soltar da área de trabalho (a nota continua guardada)"
            title="Soltar da área de trabalho (a nota continua guardada)"
            onClick={() => void patch({ pinned: false })}
          >
            ✕
          </button>
        </div>
      </header>
      {colors && (
        <div className="note-color-row" role="radiogroup" aria-label="Cor do papel">
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
              onClick={() => {
                void patch({ color: c });
                setColors(false);
              }}
            />
          ))}
        </div>
      )}
      <NoteEditor key={note.id} initialDoc={note.doc} remote={remote} onChange={saveDoc} toolbar={tools} compact />
    </main>
  );
}
