import { MascotView } from './features/mascot/MascotView';
import { PanelView } from './features/panel/PanelView';
import { NoteWindow } from './features/notes/NoteWindow';
import { NotesManager } from './features/notes/NotesManager';
import { AssistantView } from './features/assistant/AssistantView';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A mesma build serve todas as janelas; o hash define qual view renderizar. */
export function App() {
  const hash = window.location.hash;
  if (hash === '#panel') return <PanelView />;
  if (hash === '#assistant') return <AssistantView />;
  if (hash === '#notes' || hash.startsWith('#notes=')) {
    const id = hash.slice('#notes='.length);
    return <NotesManager initialId={UUID.test(id) ? id : null} />;
  }
  if (hash.startsWith('#note=')) {
    const id = hash.slice('#note='.length);
    if (UUID.test(id)) return <NoteWindow id={id} />;
  }
  return <MascotView />;
}
