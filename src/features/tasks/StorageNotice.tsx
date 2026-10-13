import { useEffect, useState } from 'react';

/**
 * Aviso sobre o armazenamento das tarefas (arquivo danificado que foi recuperado, banco de uma
 * versão mais nova, falha ao abrir). Vem do processo principal e pode ser dispensado.
 */
export function StorageNotice() {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.mochi.tasks.notice().then((value) => alive && setNotice(value));
    return () => {
      alive = false;
    };
  }, []);

  if (!notice) return null;
  return (
    <div className="tasks-notice" role="status">
      <p>{notice}</p>
      <button
        type="button"
        onClick={() => {
          setNotice(null);
          void window.mochi.tasks.dismissNotice();
        }}
      >
        Entendi
      </button>
    </div>
  );
}