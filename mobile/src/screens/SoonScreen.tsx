import { Icon } from '../ui/Icon';

/** Telas que ainda não existem no celular (Foco e Notas chegam nas próximas etapas). */
export function SoonScreen({ title, icon, text }: { title: string; icon: string; text: string }) {
  return (
    <div className="screen" data-testid={`screen-${title.toLowerCase()}`}>
      <header className="screen-head">
        <h1>{title}</h1>
      </header>
      <div className="empty-card big">
        <Icon name={icon} size={34} />
        <p>{text}</p>
        <p className="muted">Já funciona no computador e chega aqui em breve.</p>
      </div>
    </div>
  );
}
