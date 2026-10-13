import { useEffect, useState } from 'react';
import type { PanelView as PanelScreen } from '../../../shared/ipc';
import { TasksView } from '../tasks/TasksView';
import { FocusView } from '../focus/FocusView';
import { useFocus } from '../focus/useFocus';
import { SettingsView } from '../settings/SettingsView';
import { useSettings } from '../settings/useSettings';
import { useTheme } from '../settings/useTheme';
import './panel.css';

/** Painel (modo flutuante e configurações): tarefas e modo foco; notas e IA entram aqui depois. */
export function PanelView() {
  const focus = useFocus();
  const { settings } = useSettings();
  const theme = useTheme(settings.theme);
  const [screen, setScreen] = useState<PanelScreen>('home');

  // A tela pedida por quem abriu o painel (bandeja, engrenagem da ilha) e mudanças posteriores.
  useEffect(() => {
    let alive = true;
    void window.mochi.panel.initialView().then((view) => alive && setScreen(view));
    const off = window.mochi.panel.onNavigate((view) => setScreen(view));
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (screen === 'settings') {
    return (
      <main className="panel panel-settings" data-theme={theme}>
        <SettingsView onBack={() => setScreen('home')} />
      </main>
    );
  }

  return (
    <main className="panel" data-theme={theme}>
      <div className="panel-bar">
        <span>Mochi</span>
        <button type="button" className="panel-gear" onClick={() => setScreen('settings')} aria-label="Abrir configurações" title="Configurações">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <FocusView variant="panel" focus={focus} />
      <TasksView variant="panel" />
    </main>
  );
}
