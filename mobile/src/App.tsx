import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Task } from '../../shared/tasks';
import { useMascot } from '../../src/features/mascot/useMascot';
import type { Core } from './core';
import { parseProfile, serializeProfile, type Profile } from './profile';
import { useTasks } from './useTasks';
import { Icon } from './ui/Icon';
import { AddTaskSheet, EditTaskSheet } from './ui/TaskSheets';
import { FocusScreen } from './screens/FocusScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SoonScreen } from './screens/SoonScreen';
import { TasksScreen } from './screens/TasksScreen';
import { TodayScreen } from './screens/TodayScreen';

type Tab = 'today' | 'tasks' | 'focus' | 'notes' | 'profile';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Hoje', icon: 'today' },
  { id: 'tasks', label: 'Tarefas', icon: 'tasks' },
  { id: 'focus', label: 'Foco', icon: 'focus' },
  { id: 'notes', label: 'Notas', icon: 'notes' },
  { id: 'profile', label: 'Perfil', icon: 'profile' },
];

/** Casca do app: navegação inferior, estado das tarefas e o mascote. */
export function App({ core }: { core: Core }) {
  const [tab, setTab] = useState<Tab>('today');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [version, bump] = useState(0);
  const tasks = useTasks(core);
  const mascot = useMascot();
  // `version` muda quando o núcleo avisa (preferência alterada): recalcula o perfil.
  const profile = useMemo(() => parseProfile(core.getPref('profile')), [core, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => core.subscribe(() => bump((n) => n + 1)), [core]);
  useEffect(() => mascot.greet(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(
    (task: Task) => {
      if (task.completed) void core.tasks.reopen(task.id);
      else {
        void core.tasks.complete(task.id);
        mascot.celebrate();
      }
    },
    [core, mascot],
  );

  const changeProfile = (next: Profile) => core.setPref('profile', serializeProfile(next));
  const state = core.syncState();
  const account = core.auth.account();
  const syncLabel = !account
    ? 'Sem conta'
    : !core.syncEnabled()
      ? 'Pausado'
      : state.status === 'syncing'
        ? 'Sincronizando…'
        : state.status === 'login'
          ? 'Entre de novo'
          : state.status === 'error'
            ? 'Erro'
            : state.lastSync
              ? 'Sincronizado'
              : 'Pronto';

  const openEdit = useCallback((task: Task) => setEditing(task), []);
  const subtasks = editing ? [...tasks.active, ...tasks.completed].filter((t) => t.parentId === editing.id) : [];

  return (
    <div className="app">
      <header className="appbar">
        <span className="brand">{profile.name}</span>
        <span className="chip" data-testid="status" data-status={state.status}>
          {syncLabel}
        </span>
      </header>

      {core.recovered && (
        <p className="banner" role="status">
          Os dados deste aparelho estavam danificados; estamos baixando tudo da nuvem.
        </p>
      )}

      <main className="content">
        {tab === 'today' && (
          <TodayScreen
            profile={profile}
            mascot={mascot}
            tasks={tasks.active}
            onAdd={() => setAdding(true)}
            onOpenTasks={() => setTab('tasks')}
            onToggle={toggle}
          />
        )}
        {tab === 'tasks' && (
          <TasksScreen active={tasks.active} completed={tasks.completed} onToggle={toggle} onOpen={openEdit} onAdd={() => setAdding(true)} />
        )}
        {tab === 'focus' && <FocusScreen core={core} tasks={tasks.active} onCompleteTask={toggle} />}
        {tab === 'notes' && <SoonScreen title="Notas" icon="notes" text="Notas com formatação." />}
        {tab === 'profile' && <ProfileScreen core={core} profile={profile} onChange={changeProfile} />}
      </main>

      {tasks.pending && (
        <div className="snackbar" role="status" data-testid="snackbar">
          <span>
            Tarefa excluída{tasks.pending.count > 0 ? ` (com ${tasks.pending.count} subtarefa${tasks.pending.count > 1 ? 's' : ''})` : ''}.
          </span>
          <button type="button" onClick={tasks.undo} data-testid="undo">
            <Icon name="undo" size={16} /> Desfazer
          </button>
        </div>
      )}

      <nav className="tabbar" aria-label="Principal">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} data-testid={`tab-${t.id}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {adding && <AddTaskSheet core={core} onClose={() => setAdding(false)} />}
      {editing && (
        <EditTaskSheet
          core={core}
          task={editing}
          subtasks={subtasks}
          onDelete={(t) => tasks.remove(t)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
