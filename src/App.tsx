import { MascotView } from './features/mascot/MascotView';
import { PanelView } from './features/panel/PanelView';

/** A mesma build serve as duas janelas; o hash define qual view renderizar. */
export function App() {
  return window.location.hash === '#panel' ? <PanelView /> : <MascotView />;
}
