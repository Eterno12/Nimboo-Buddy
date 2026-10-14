/**
 * Barra de título das janelas de vidro (sem moldura do sistema). Fica escondida quando a janela tem a
 * moldura normal (Windows 10): o main marca `html[data-frameless]` só nas janelas que precisam dela.
 */
export function TitleBar() {
  return (
    <div className="titlebar" data-testid="titlebar">
      <span className="titlebar-title">Nimboo</span>
      <div className="titlebar-buttons">
        <button type="button" aria-label="Minimizar" onClick={() => window.mochi.windowControl('minimize')}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" aria-label="Maximizar" onClick={() => window.mochi.windowControl('maximize')}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button type="button" className="titlebar-close" aria-label="Fechar" onClick={() => window.mochi.windowControl('close')}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
