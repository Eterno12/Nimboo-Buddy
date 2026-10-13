import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note, NoteDoc } from '../../../shared/notes';

/**
 * Uma nota na interface: carrega, salva o documento (com a mesma ordem de gravação, sem corridas),
 * acompanha mudanças feitas em outras janelas e entrega `remote` ao editor quando o texto mudou lá.
 */
export function useNote(id: string | null) {
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<{ doc: NoteDoc; rev: number } | null>(null);
  const rev = useRef(0);
  /** Gravações em andamento: a confirmação da própria gravação não conta como "mudança remota". */
  const saving = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    if (!id) {
      setNote(null);
      return;
    }
    const result = await window.mochi.notes.get(id);
    if (result.ok) {
      setNote(result.value);
      setError(null);
    } else {
      setNote(null);
      setError(result.error.message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    return window.mochi.notes.onChange((change) => {
      if (change.id !== id) return;
      if (change.type === 'removed') {
        setNote(null);
        setError('A nota foi excluída.');
        return;
      }
      void window.mochi.notes.get(id).then((r) => {
        if (!r.ok) return;
        setNote(r.value);
        const touchedDoc = change.type === 'updated' && change.fields.includes('doc');
        if (touchedDoc && saving.current === 0) {
          rev.current += 1;
          setRemote({ doc: r.value.doc, rev: rev.current });
        }
      });
    });
  }, [id]);

  const saveDoc = useCallback(
    (doc: NoteDoc) => {
      if (!id) return;
      saving.current += 1;
      chain.current = chain.current
        .then(() => window.mochi.notes.update(id, { doc }))
        .then((r) => {
          if (!r.ok) setError(r.error.message);
        })
        .finally(() => {
          saving.current -= 1;
        });
    },
    [id],
  );

  const patch = useCallback(
    async (fields: { color?: string; pinned?: boolean }) => {
      if (!id) return;
      const r = await window.mochi.notes.update(id, fields);
      if (r.ok) setNote(r.value);
      else setError(r.error.message);
    },
    [id],
  );

  return { note, error, remote, saveDoc, patch, reload: load };
}
