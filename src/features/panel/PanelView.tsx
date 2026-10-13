import { TasksView } from '../tasks/TasksView';
import { FocusView } from '../focus/FocusView';
import { useFocus } from '../focus/useFocus';
import './panel.css';

/** Painel (modo flutuante): tarefas e modo foco; notas e IA entram aqui depois. */
export function PanelView() {
  const focus = useFocus();
  return (
    <main className="panel">
      <FocusView variant="panel" focus={focus} />
      <TasksView variant="panel" />
    </main>
  );
}