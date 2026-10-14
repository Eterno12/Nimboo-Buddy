import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { EMPTY_MEDIA, sanitizeMedia, type MediaCommand, type MediaState } from '../../shared/media.ts';

/**
 * Leitor do controle de mídia do Windows (SMTC) num PowerShell oculto e persistente. Ele escreve linhas
 * `STATE <base64 json>`, `THUMB <base64 mime> <base64 bytes>`, `READY` e `ERR <base64>`; lê comandos pela
 * entrada padrão (`toggle`, `play`, `pause`, `next`, `prev`, `seek <segundos>`). Nada sai do computador.
 */
export function mediaScript(): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]',
    '[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]',
    '[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime]',
    '[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime]',
    "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    "function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(8000); if (-not $t.IsCompleted) { throw 'timeout' }; $t.Result }",
    'function B64($s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$s)) }',
    "function Emit($line) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }",
    '$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])',
    "$q = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'",
    '$sync = [hashtable]::Synchronized(@{ done = $false })',
    '$rs = [runspacefactory]::CreateRunspace(); $rs.Open()',
    '$ps = [powershell]::Create(); $ps.Runspace = $rs',
    '[void]$ps.AddScript({ param($q, $sync) while ($true) { $l = [Console]::In.ReadLine(); if ($null -eq $l) { break }; $q.Enqueue($l) }; $sync.done = $true }).AddArgument($q).AddArgument($sync)',
    '[void]$ps.BeginInvoke()',
    "$script:lastKey = ''; $script:lastThumb = ''; $script:lastEmit = [DateTime]::MinValue",
    'function RunCommand($cmd) {',
    '  $s = $mgr.GetCurrentSession(); if ($null -eq $s) { return }',
    "  $parts = $cmd.Trim().Split(' ')",
    '  switch ($parts[0]) {',
    "    'toggle' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }",
    "    'play' { [void](Await ($s.TryPlayAsync()) ([bool])) }",
    "    'pause' { [void](Await ($s.TryPauseAsync()) ([bool])) }",
    "    'next' { [void](Await ($s.TrySkipNextAsync()) ([bool])) }",
    "    'prev' { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }",
    "    'seek' { $secs = [double]::Parse($parts[1], [Globalization.CultureInfo]::InvariantCulture); [void](Await ($s.TryChangePlaybackPositionAsync([long]($secs * 10000000))) ([bool])) }",
    '  }',
    '}',
    'function Tick {',
    '  $s = $mgr.GetCurrentSession()',
    '  if ($null -eq $s) {',
    "    $key = 'none'",
    '    if ($key -ne $script:lastKey -or ([DateTime]::UtcNow - $script:lastEmit).TotalSeconds -gt 5) {',
    "      Emit ('STATE ' + (B64 '{\"status\":\"none\"}'))",
    '      $script:lastKey = $key; $script:lastEmit = [DateTime]::UtcNow',
    '    }',
    '    return',
    '  }',
    '  $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])',
    '  $pb = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties(); $c = $pb.Controls',
    "  $status = $pb.PlaybackStatus.ToString()",
    "  $key = ($status, $props.Title, $props.Artist, $props.AlbumTitle, $s.SourceAppUserModelId, $c.IsNextEnabled, $c.IsPreviousEnabled, $c.IsPlayPauseToggleEnabled, $c.IsPlaybackPositionEnabled) -join '|'",
    '  $due = ([DateTime]::UtcNow - $script:lastEmit).TotalSeconds -gt 5',
    '  if ($key -eq $script:lastKey -and -not $due) { return }',
    '  $updated = $tl.LastUpdatedTime',
    '  if ($updated.Year -lt 2000) { $updated = [DateTimeOffset]::UtcNow }',
    '  $len = ($tl.EndTime - $tl.StartTime).TotalSeconds',
    '  $obj = @{',
    '    status = $status; title = [string]$props.Title; artist = [string]$props.Artist; album = [string]$props.AlbumTitle;',
    '    app = [string]$s.SourceAppUserModelId; position = ($tl.Position - $tl.StartTime).TotalSeconds; duration = $len;',
    '    updatedAt = $updated.ToUnixTimeMilliseconds();',
    '    canPlayPause = [bool]$c.IsPlayPauseToggleEnabled; canNext = [bool]$c.IsNextEnabled; canPrev = [bool]$c.IsPreviousEnabled; canSeek = [bool]$c.IsPlaybackPositionEnabled',
    '  }',
    "  $trackKey = ($props.Title, $props.Artist, $props.AlbumTitle, $s.SourceAppUserModelId) -join '|'",
    '  if ($trackKey -ne $script:lastThumb) {',
    '    $script:lastThumb = $trackKey',
    '    try {',
    '      if ($null -ne $props.Thumbnail) {',
    '        $st = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])',
    '        if ($st.Size -gt 0 -and $st.Size -lt 400000) {',
    '          $r = New-Object Windows.Storage.Streams.DataReader($st)',
    '          $n = Await ($r.LoadAsync([uint32]$st.Size)) ([uint32])',
    '          $b = New-Object byte[] $n; $r.ReadBytes($b)',
    "          Emit ('THUMB ' + (B64 $st.ContentType) + ' ' + [Convert]::ToBase64String($b))",
    '        } else { Emit ("THUMB " + (B64 "") + " ") }',
    '      } else { Emit ("THUMB " + (B64 "") + " ") }',
    '    } catch { Emit ("THUMB " + (B64 "") + " ") }',
    '  }',
    "  Emit ('STATE ' + (B64 ($obj | ConvertTo-Json -Compress)))",
    '  $script:lastKey = $key; $script:lastEmit = [DateTime]::UtcNow',
    '}',
    "Emit 'READY'",
    'while (-not $sync.done) {',
    '  $cmd = [string]$null',
    '  while ($q.TryDequeue([ref]$cmd)) { try { RunCommand $cmd } catch { }; $script:lastKey = "" }',
    '  try { Tick } catch { Emit ("ERR " + (B64 $_.Exception.Message)) }',
    '  Start-Sleep -Milliseconds 500',
    '}',
  ].join('\n');
}

export type MediaLine =
  | { type: 'ready' }
  | { type: 'state'; json: unknown }
  | { type: 'thumb'; mime: string; base64: string }
  | { type: 'error'; message: string };

const fromB64 = (s: string): string => Buffer.from(s, 'base64').toString('utf8');

/** Interpreta uma linha do leitor; linhas desconhecidas ou malformadas viram `null`. */
export function parseMediaLine(line: string): MediaLine | null {
  const text = line.trim();
  if (text === 'READY') return { type: 'ready' };
  if (text === 'THUMB') return { type: 'thumb', mime: '', base64: '' }; // sem capa (mime e dados vazios)
  const space = text.indexOf(' ');
  if (space === -1) return null;
  const tag = text.slice(0, space);
  const rest = text.slice(space + 1);
  try {
    if (tag === 'STATE') return { type: 'state', json: JSON.parse(fromB64(rest)) };
    if (tag === 'THUMB') {
      const [mime64, data = ''] = rest.split(' ');
      return { type: 'thumb', mime: fromB64(mime64 ?? ''), base64: data.trim() };
    }
    if (tag === 'ERR') return { type: 'error', message: fromB64(rest).slice(0, 200) };
  } catch {
    return null;
  }
  return null;
}

export interface MediaSource {
  start(): void;
  stop(): void;
  command(cmd: MediaCommand): void;
  state(): MediaState;
}

interface Options {
  onChange(state: MediaState): void;
  spawn?: typeof nodeSpawn;
}

const THUMB_MIME = /^image\/(png|jpeg|jpg|webp|gif|bmp)$/;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;

/** Fonte real: o PowerShell persistente (reinicia até 3 vezes por minuto; depois desiste em silêncio). */
export function createMediaSession({ onChange, spawn = nodeSpawn }: Options): MediaSource {
  let child: ChildProcess | null = null;
  let current: MediaState = { ...EMPTY_MEDIA };
  let thumbnail: string | null = null;
  let lastRaw: unknown = null;
  let buffer = '';
  let stopped = true;
  let restarts: number[] = [];
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const publish = () => {
    current = lastRaw === null ? { ...EMPTY_MEDIA, available: current.available } : sanitizeMedia(lastRaw, thumbnail);
    onChange(current);
  };

  const handle = (line: MediaLine) => {
    if (line.type === 'ready') {
      current = { ...current, available: true };
      onChange(current);
    } else if (line.type === 'state') {
      lastRaw = line.json;
      publish();
    } else if (line.type === 'thumb') {
      thumbnail = THUMB_MIME.test(line.mime) && line.base64 ? `data:${line.mime};base64,${line.base64}` : null;
      if (lastRaw !== null) publish();
    }
  };

  const launch = () => {
    if (stopped) return;
    try {
      const encoded = Buffer.from(mediaScript(), 'utf16le').toString('base64');
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
      );
      child = proc;
      buffer = '';
      proc.stdout?.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        let idx: number;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          const parsed = parseMediaLine(line);
          if (parsed) handle(parsed);
        }
        if (buffer.length > 2_000_000) buffer = '';
      });
      proc.stdin?.on('error', () => undefined);
      const onEnd = () => {
        if (child !== proc) return;
        child = null;
        lastRaw = null;
        thumbnail = null;
        current = { ...EMPTY_MEDIA };
        onChange(current);
        if (stopped) return;
        const now = Date.now();
        restarts = restarts.filter((t) => now - t < RESTART_WINDOW_MS);
        if (restarts.length >= MAX_RESTARTS) return;
        restarts.push(now);
        restartTimer = setTimeout(launch, 2000);
      };
      proc.on('error', onEnd);
      proc.on('exit', onEnd);
    } catch {
      child = null;
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      restarts = [];
      launch();
    },
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      const proc = child;
      child = null;
      try {
        proc?.stdin?.end();
        proc?.kill();
      } catch {
        /* já encerrado */
      }
      lastRaw = null;
      thumbnail = null;
      current = { ...EMPTY_MEDIA };
      onChange(current);
    },
    command(cmd) {
      const stdin = child?.stdin;
      if (!stdin || stdin.destroyed) return;
      const text = cmd.type === 'seek' ? `seek ${cmd.seconds.toFixed(1)}` : cmd.type;
      try {
        stdin.write(`${text}\n`);
      } catch {
        /* processo caindo */
      }
    },
    state: () => current,
  };
}

/**
 * Só para testes e2e (app NÃO empacotado): MOCHI_E2E_MEDIA_FIXTURE aponta um JSON com o estado
 * ({ status, title, artist, ... } como o leitor real) que é relido a cada 200 ms; comandos são anexados a
 * `<arquivo>.commands` (um por linha). Nada é executado no Windows.
 */
export function createFixtureMedia(file: string, onChange: (s: MediaState) => void): MediaSource {
  let timer: ReturnType<typeof setInterval> | undefined;
  let last = '';
  let current: MediaState = { ...EMPTY_MEDIA };
  const read = () => {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (text === last) return;
      last = text;
      const data = JSON.parse(text) as { thumbnail?: unknown } & Record<string, unknown>;
      const thumb = typeof data.thumbnail === 'string' ? data.thumbnail : null;
      current = sanitizeMedia({ updatedAt: Date.now(), ...data }, thumb);
      onChange(current);
    } catch {
      /* arquivo ainda sendo escrito */
    }
  };
  return {
    start() {
      current = { ...EMPTY_MEDIA, available: true };
      onChange(current);
      read();
      timer = setInterval(read, 200);
    },
    stop() {
      clearInterval(timer);
      current = { ...EMPTY_MEDIA };
      onChange(current);
    },
    command(cmd) {
      try {
        fs.appendFileSync(`${file}.commands`, `${JSON.stringify(cmd)}\n`);
      } catch {
        /* sem permissão */
      }
    },
    state: () => current,
  };
}
