import { spawn as nodeSpawn } from 'node:child_process';

/**
 * Valores de `SHQueryUserNotificationState` (shell32): é a mesma informação que o Windows usa
 * para decidir se pode mostrar notificações. Não depende de módulos nativos.
 */
export const NOTIFICATION_STATE = {
  NOT_PRESENT: 1,
  BUSY: 2, // app em tela cheia (jogo, vídeo, apresentação sem modo dedicado)
  D3D_FULL_SCREEN: 3, // tela cheia exclusiva (jogos)
  PRESENTATION_MODE: 4, // modo de apresentação
  ACCEPTS_NOTIFICATIONS: 5, // normal
  QUIET_TIME: 6, // assistente de foco (não é tela cheia)
  APP: 7, // app da Microsoft Store em tela cheia
} as const;

/** Estados em que a ilha e o Nimboo devem sair da frente. */
export function isFullscreenState(state: number): boolean {
  return (
    state === NOTIFICATION_STATE.BUSY ||
    state === NOTIFICATION_STATE.D3D_FULL_SCREEN ||
    state === NOTIFICATION_STATE.PRESENTATION_MODE ||
    state === NOTIFICATION_STATE.APP
  );
}

/** Lê uma linha `STATE <n>` do vigia; qualquer outra coisa é ignorada. */
export function parseStateLine(line: string): number | null {
  const m = /^STATE (\d{1,2})\s*$/.exec(line.trim());
  return m ? Number(m[1]) : null;
}

/** Script do vigia: imprime `STATE <n>` quando o estado muda e sai se o app pai sumir. */
export function watcherScript(parentPid: number, pollMs: number): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -Namespace Nimboo -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'`,
    '$last = -1',
    'while ($true) {',
    `  if (-not (Get-Process -Id ${Math.trunc(parentPid)} -ErrorAction SilentlyContinue)) { break }`,
    '  $s = 0',
    '  [void][Nimboo.Shell]::SHQueryUserNotificationState([ref]$s)',
    '  if ($s -ne $last) { $last = $s; [Console]::Out.WriteLine("STATE $s"); [Console]::Out.Flush() }',
    `  Start-Sleep -Milliseconds ${Math.trunc(pollMs)}`,
    '}',
  ].join('; ');
}

export interface FullscreenWatcherOptions {
  /** Chamado quando passa a haver (ou deixa de haver) um app em tela cheia. */
  onChange(fullscreen: boolean): void;
  pollMs?: number;
  /** Injetável nos testes. */
  spawn?: typeof nodeSpawn;
  parentPid?: number;
}

export interface FullscreenWatcher {
  stop(): void;
}

/**
 * Vigia (processo PowerShell oculto, um por execução do app) que informa quando um app
 * entra ou sai da tela cheia. Falhas só desligam a função: o app segue funcionando.
 */
export function startFullscreenWatcher(options: FullscreenWatcherOptions): FullscreenWatcher {
  const spawn = options.spawn ?? nodeSpawn;
  const script = watcherScript(options.parentPid ?? process.pid, options.pollMs ?? 1500);
  let fullscreen = false;
  let stopped = false;
  let buffer = '';

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );

  const handleLine = (line: string) => {
    const state = parseStateLine(line);
    if (state === null) return;
    const next = isFullscreenState(state);
    if (next !== fullscreen) {
      fullscreen = next;
      if (!stopped) options.onChange(next);
    }
  };

  child.stdout?.on('data', (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
  });
  child.on('error', (error: Error) => console.error('Vigia de tela cheia indisponível:', error.message));

  return {
    stop() {
      stopped = true;
      try {
        child.kill();
      } catch {
        /* já encerrado */
      }
    },
  };
}
