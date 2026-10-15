import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Sheet } from './Sheet';

interface Props {
  /** Chamado uma vez com o texto lido (ou colado). */
  onResult(text: string): void;
  onClose(): void;
}

/** Lê o QR do PC com a câmera traseira. Se a câmera não abrir, dá para colar o texto do QR. */
export function QrScanner({ onResult, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const done = useRef(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      const v = video.current;
      if (stopped || !v || !ctx) return;
      if (v.readyState >= 2 && v.videoWidth > 0 && !done.current) {
        // Reduz para ~480 px de largura: leitura rápida sem perder módulos do QR.
        const scale = Math.min(1, 480 / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          done.current = true;
          resultRef.current(code.data);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        raf = requestAnimationFrame(tick);
      } catch {
        setProblem('Não consegui abrir a câmera. Permita o acesso à câmera nas configurações do app, ou cole o texto do QR abaixo.');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <Sheet title="Escanear QR do PC" onClose={onClose}>
      <video ref={video} className="qr-video" playsInline muted data-testid="qr-video" />
      <p className="muted">No PC: Configurações → Conta e sincronização → Conectar o celular → Mostrar QR.</p>
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
      <label className="field">
        <span>Ou cole o texto do QR</span>
        <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="nimboo://pair?…" data-testid="qr-paste" />
      </label>
      <button type="button" className="btn-soft" disabled={pasted.trim() === ''} data-testid="qr-use-paste" onClick={() => onResult(pasted.trim())}>
        Usar este texto
      </button>
    </Sheet>
  );
}
