import { useEffect, useMemo, useState } from 'react';
import { qrMatrix } from '../../../shared/sync/qr';
import { PAIRING_TTL_MS } from '../../../shared/sync/pairing';

const MARGIN = 2;

/** Desenha o QR como SVG (um único caminho, nítido em qualquer tela). */
function QrSvg({ text }: { text: string }) {
  const { path, size } = useMemo(() => {
    const m = qrMatrix(text);
    let d = '';
    m.forEach((row, r) =>
      row.forEach((on, c) => {
        if (on) d += `M${c + MARGIN} ${r + MARGIN}h1v1h-1z`;
      }),
    );
    return { path: d, size: m.length + MARGIN * 2 };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={208} height={208} role="img" aria-label="QR para conectar o celular" shapeRendering="crispEdges" data-testid="pair-qr">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** "Conectar celular": mostra um QR de uso único (2 min) que o app do celular lê para entrar na mesma conta. */
export function PairingPanel() {
  const [qr, setQr] = useState<{ text: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [qr]);

  const left = qr ? Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)) : 0;
  useEffect(() => {
    if (qr && left === 0) setQr(null); // vencido: some (o token ainda existe no servidor, mas ninguém o vê)
  }, [qr, left]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.mochi.sync.pairing();
      if (r.ok) {
        setQr({ text: r.qr, expiresAt: Date.now() + PAIRING_TTL_MS });
        setNow(Date.now());
      } else setError(r.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="settings-help">
      <summary>Conectar o celular com QR code</summary>
      <p>
        No app do celular, abra <strong>Perfil → Conta → Escanear QR do PC</strong> e aponte a câmera. O QR vale uma vez e por 2 minutos; não mostre
        para outras pessoas.
      </p>
      {qr ? (
        <div className="settings-pair">
          <QrSvg text={qr.text} />
          <p className="settings-hint" role="status" data-testid="pair-left">
            Expira em {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          </p>
          <button type="button" className="settings-small" onClick={() => setQr(null)}>
            Ocultar
          </button>
        </div>
      ) : (
        <button type="button" className="settings-small" disabled={busy} data-testid="pair-generate" onClick={() => void generate()}>
          {busy ? 'Gerando…' : 'Mostrar QR'}
        </button>
      )}
      {error && (
        <p className="settings-hint" data-tone="warn" role="alert" data-testid="pair-error">
          {error}
        </p>
      )}
    </details>
  );
}
