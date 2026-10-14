import fs from 'node:fs';
import path from 'node:path';

export const LOG_MAX_BYTES = 512 * 1024;
const LINE_MAX = 4000;

export interface LogFile {
  write(level: 'info' | 'warn' | 'error', message: string): void;
  readonly file: string;
}

/**
 * Registro local de erros (só neste computador; nada é enviado). Um arquivo com rodízio: passou do limite,
 * o atual vira `.1` (substituindo o anterior). Falhar ao gravar nunca derruba o app.
 */
export function createLogFile(dir: string, now: () => Date = () => new Date(), maxBytes = LOG_MAX_BYTES): LogFile {
  const file = path.join(dir, 'nimboo.log');
  const rotate = () => {
    try {
      if (fs.statSync(file).size >= maxBytes) fs.renameSync(file, `${file}.1`);
    } catch {
      /* ainda não existe */
    }
  };
  return {
    file,
    write(level, message) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        rotate();
        const text = message.length > LINE_MAX ? `${message.slice(0, LINE_MAX)}…` : message;
        fs.appendFileSync(file, `${now().toISOString()} ${level.toUpperCase()} ${text.replace(/\r?\n/g, '\n    ')}\n`, 'utf8');
      } catch {
        /* sem disco/permissão: segue sem log */
      }
    },
  };
}

/** Texto de um erro ou de qualquer valor (com a pilha, quando há). */
export function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
