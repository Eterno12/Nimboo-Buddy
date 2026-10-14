import { MascotView } from './features/mascot/MascotView';
import { PanelView } from './features/panel/PanelView';
import { NoteWindow } from './features/notes/NoteWindow';
import { NotesManager } from './features/notes/NotesManager';
import { AssistantView } from './features/assistant/AssistantView';
import { AchievementsView } from './features/bond/AchievementsView';
import { WelcomeView } from './features/welcome/WelcomeView';
import { ToastView } from './features/bond/ToastView';
import { TitleBar } from './features/window/TitleBar';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Janelas comuns (com barra de título): a barra só aparece quando a janela é de vidro, sem moldura. */
function Framed({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-frame">
      <TitleBar />
      <div className="app-body">{children}</div>
    </div>
  );
}

/** A mesma build serve todas as janelas; o hash define qual view renderizar. */
export function App() {
  const hash = window.location.hash;
  if (hash === '#panel') return <Framed><PanelView /></Framed>;
  if (hash === '#assistant') return <Framed><AssistantView /></Framed>;
  if (hash === '#welcome') return <Framed><WelcomeView /></Framed>;
  if (hash === '#achievements') return <Framed><AchievementsView /></Framed>;
  if (hash.startsWith('#toast=')) return <ToastView id={hash.slice('#toast='.length)} />;
  if (hash === '#notes' || hash.startsWith('#notes=')) {
    const id = hash.slice('#notes='.length);
    return <Framed><NotesManager initialId={UUID.test(id) ? id : null} /></Framed>;
  }
  if (hash.startsWith('#note=')) {
    const id = hash.slice('#note='.length);
    if (UUID.test(id)) return <NoteWindow id={id} />;
  }
  return <MascotView />;
}
