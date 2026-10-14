import { useCallback, useEffect, useState } from 'react';
import type { NoteDoc } from '../../../shared/notes';

/**
 * Notas ligadas a tarefas e eventos da agenda. Mantém dois mapas (id da tarefa → id da nota; referência do
 * evento → id da nota), recarregados quando qualquer nota muda (em qualquer janela).
 */
export function useNoteLinks() {
  const [byTask, setByTask] = useState<ReadonlyMap<string, string>>(new Map());
  const [byEvent, setByEvent] = useState<ReadonlyMap<string, string>>(new Map());

  const reload = useCallback(async () => {
    const r = await window.mochi.notes.list();
    if (!r.ok) return;
    const tasks = new Map<string, string>();
    const events = new Map<string, string>();
    for (const n of r.value) {
      if (n.taskId) tasks.set(n.taskId, n.id);
      if (n.eventRef) events.set(n.eventRef, n.id);
    }
    setByTask(tasks);
    setByEvent(events);
  }, []);

  useEffect(() => {
    void reload();
    return window.mochi.notes.onChange(() => void reload());
  }, [reload]);

  return { byTask, byEvent, reload };
}

/** Documento inicial de uma nota ligada: o título (da tarefa ou do evento) como cabeçalho. */
export function linkedNoteDoc(title: string, subtitle?: string): NoteDoc {
  const content: NoteDoc['content'] = [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] }];
  if (subtitle) content.push({ type: 'paragraph', content: [{ type: 'text', text: subtitle }] });
  content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}

/** Abre a nota ligada (criando-a na primeira vez) na janela de notas. Devolve uma mensagem de erro ou `null`. */
export async function openLinkedNote(
  link: { taskId?: string; eventRef?: string },
  title: string,
  subtitle?: string,
): Promise<string | null> {
  const r = await window.mochi.notes.create({ doc: linkedNoteDoc(title, subtitle), ...link });
  if (!r.ok) return r.error.message;
  window.mochi.notes.openManager(r.value.id);
  return null;
}
