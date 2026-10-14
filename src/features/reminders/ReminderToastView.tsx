import { useEffect, useState } from 'react';
import type { ReminderToastAction, ReminderToastInfo } from '../../../shared/reminderToast';
import { useSettings } from '../settings/useSettings';
import { useTheme } from '../settings/useTheme';
import './reminderToast.css';

/** Aviso de lembrete no canto da tela, com os botões Concluir, Adiar e Dispensar. */
export function ReminderToastView({ token }: { token: string }) {
  const { settings } = useSettings();
  const theme = useTheme(settings.theme);
  const [info, setInfo] = useState<ReminderToastInfo | null>(null);

  // A janela é transparente: o fundo opaco que o tema põe no documento não vale aqui.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, [theme]);

  useEffect(() => {
    let alive = true;
    void window.mochi.reminder
      .get(token)
      .then((value) => {
        if (alive) setInfo(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token]);

  const act = (action: ReminderToastAction) => window.mochi.reminder.act(token, action);

  if (!info) return <main className="rem-host" data-theme={theme} />;

  const heading = info.snoozed
    ? 'Lembrete adiado'
    : info.kind === 'due'
      ? 'Chegou a hora'
      : `Em ${info.minutes} minutos`;

  return (
    <main className="rem-host" data-theme={theme}>
      <div className="rem-card" role="alertdialog" aria-label={heading}>
        <span className="rem-kicker">{heading}</span>
        <strong className="rem-title" title={info.title}>
          {info.title}
        </strong>
        <div className="rem-actions">
          {info.canComplete && (
            <button type="button" className="rem-btn" data-primary="true" onClick={() => act('complete')}>
              Concluir
            </button>
          )}
          <button type="button" className="rem-btn" onClick={() => act('snooze')}>
            Adiar 10 min
          </button>
          <button type="button" className="rem-btn" onClick={() => act('dismiss')}>
            Dispensar
          </button>
        </div>
      </div>
    </main>
  );
}
