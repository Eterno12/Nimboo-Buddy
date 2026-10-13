import { TasksView } from '../tasks/TasksView';
import './panel.css';

/** Painel (modo flutuante): hoje mostra as tarefas; timers e IA entram aqui depois. */
export function PanelView() {
  return (
    <main className="panel">
      <TasksView variant="panel" />
    </main>
  );
}