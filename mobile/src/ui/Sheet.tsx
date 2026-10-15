import { useEffect, useRef, type ReactNode } from 'react';

interface SheetProps {
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** Folha que sobe da base (padrão de celular): fecha no fundo, no X e com o botão voltar/Esc. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Voltar do Android fecha a folha em vez de sair da tela.
    history.pushState({ sheet: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
    };
  }, [onClose]);

  return (
    <div className="sheet-root">
      <button type="button" className="sheet-backdrop" aria-label="Fechar" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          <h2>{title}</h2>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
