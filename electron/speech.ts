import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';

/**
 * Reconhecimento de voz pelo próprio Windows (`Windows.Media.SpeechRecognition`, ditado em pt-BR), numa
 * sessão curta de PowerShell oculto: ouve UMA frase, imprime o resultado e sai. Sem módulos nativos e
 * sem baixar nada. Importante: o ditado do Windows depende da opção "Reconhecimento de fala online" do
 * Windows (Privacidade > Fala): com ela ligada, o áudio é processado pelo serviço de fala da Microsoft.
 */

export type SpeechErrorCode = 'privacy' | 'microphone' | 'no_speech' | 'busy' | 'unavailable' | 'timeout' | 'canceled';

export interface SpeechError {
  code: SpeechErrorCode;
  message: string;
}

export type SpeechResult = { ok: true; text: string } | { ok: false; error: SpeechError };

const MESSAGES: Record<SpeechErrorCode, string> = {
  privacy:
    'O Windows está com o reconhecimento de fala online desligado. Ative em Configurações > Privacidade > Fala e tente de novo.',
  microphone: 'Não consegui usar o microfone. Confira se o Windows permite que apps de desktop o usem.',
  no_speech: 'Não ouvi nada. Fale perto do microfone e tente de novo.',
  busy: 'Já estou ouvindo.',
  unavailable: 'O reconhecimento de voz não está disponível neste computador.',
  timeout: 'Demorei demais para entender. Tente de novo.',
  canceled: 'Escuta cancelada.',
};

export const speechError = (code: SpeechErrorCode): SpeechResult => ({ ok: false, error: { code, message: MESSAGES[code] } });

/** Códigos HRESULT conhecidos do reconhecedor do Windows. */
const HRESULT_PRIVACY = 0x80045509;
const HRESULT_ACCESS_DENIED = 0x80070005;
const HRESULT_NO_MIC = 0xc00d3704;

export function mapHresult(hex: string): SpeechErrorCode {
  const value = Number.parseInt(hex.replace(/^0x/i, ''), 16) >>> 0;
  if (value === HRESULT_PRIVACY) return 'privacy';
  if (value === HRESULT_ACCESS_DENIED || value === HRESULT_NO_MIC) return 'microphone';
  return 'unavailable';
}

/**
 * Interpreta a saída do script. Formato: `RESULT <texto em base64 UTF-8>` ou `STATUS <nome>` ou
 * `ERROR <hresult em hexadecimal>`. Qualquer outra linha é ignorada.
 */
export function parseSpeechOutput(output: string): SpeechResult | null {
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    const result = /^RESULT ?([A-Za-z0-9+/=]*)$/.exec(line);
    if (result) {
      const text = Buffer.from(result[1], 'base64').toString('utf8').replace(/\s+/g, ' ').trim();
      return text ? { ok: true, text: text.slice(0, 600) } : speechError('no_speech');
    }
    const error = /^ERROR (?:0x)?([0-9A-Fa-f]{1,8})$/.exec(line);
    if (error) return speechError(mapHresult(error[1]));
    const status = /^STATUS (\w+)$/.exec(line);
    if (status) {
      const s = status[1];
      if (s === 'Success') continue;
      if (s === 'TimeoutExceeded' || s === 'UserCanceled') return speechError('no_speech');
      if (s === 'MicrophoneUnavailable') return speechError('microphone');
      if (s === 'TopicLanguageNotSupported' || s === 'GrammarLanguageMismatch') return speechError('unavailable');
      return speechError('no_speech');
    }
  }
  return null;
}

/** Script de uma sessão de escuta (uma frase). `language` é uma etiqueta BCP-47 simples (pt-BR). */
export function listenScript(language: string, initialSilenceSec = 6, endSilenceSec = 1.5): string {
  const tag = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(language) ? language : 'pt-BR';
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '[void][Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType=WindowsRuntime]',
    '[void][Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]',
    "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    'function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); [void]$t.Wait(30000); if (-not $t.IsCompleted) { throw "timeout" }; $t.Result }',
    'try {',
    `  $rec = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer((New-Object Windows.Globalization.Language('${tag}')))`,
    `  $rec.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(${initialSilenceSec})`,
    '  $rec.Timeouts.BabbleTimeout = [TimeSpan]::FromSeconds(4)',
    `  $rec.Timeouts.EndSilenceTimeout = [TimeSpan]::FromSeconds(${endSilenceSec})`,
    '  $c = Await ($rec.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])',
    '  if ($c.Status -ne "Success") { [Console]::Out.WriteLine("STATUS " + $c.Status); exit 0 }',
    '  $r = Await ($rec.RecognizeAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionResult])',
    '  if ($r.Status -eq "Success" -and $r.Text) { [Console]::Out.WriteLine("RESULT " + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($r.Text))) } else { [Console]::Out.WriteLine("STATUS " + $r.Status) }',
    '} catch {',
    '  $h = $_.Exception.HResult; if ($_.Exception.InnerException) { $h = $_.Exception.InnerException.HResult }',
    '  [Console]::Out.WriteLine("ERROR " + ("{0:X8}" -f $h))',
    '}',
  ].join('; ').replace(/\{; /g, '{ ').replace(/; \}/g, ' }');
}

export interface SpeechListenerOptions {
  language?: string;
  /** Injetável nos testes. */
  spawn?: typeof nodeSpawn;
  /** Tempo máximo total da sessão (ms). */
  maxMs?: number;
}

export interface SpeechListener {
  /** Ouve uma frase. Só uma sessão por vez (`busy` se já houver). */
  listen(): Promise<SpeechResult>;
  /** Interrompe a escuta em andamento. */
  cancel(): void;
}

export function createSpeechListener(options: SpeechListenerOptions = {}): SpeechListener {
  const spawn = options.spawn ?? nodeSpawn;
  let current: { child: ChildProcess; finish: (r: SpeechResult) => void } | null = null;

  return {
    listen() {
      if (current) return Promise.resolve(speechError('busy'));
      return new Promise<SpeechResult>((resolve) => {
        let output = '';
        let settled = false;
        let child: ChildProcess;
        const finish = (result: SpeechResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          current = null;
          try {
            child?.kill();
          } catch {
            /* já encerrado */
          }
          resolve(result);
        };
        try {
          child = spawn(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', listenScript(options.language ?? 'pt-BR')],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
          );
        } catch {
          resolve(speechError('unavailable'));
          return;
        }
        const timer = setTimeout(() => finish(speechError('timeout')), options.maxMs ?? 25_000);
        current = { child, finish };
        child.stdout?.on('data', (chunk: Buffer | string) => {
          output += chunk.toString();
          const parsed = parseSpeechOutput(output);
          if (parsed) finish(parsed);
        });
        child.on('error', () => finish(speechError('unavailable')));
        child.on('exit', () => finish(parseSpeechOutput(output) ?? speechError('no_speech')));
      });
    },
    cancel() {
      current?.finish(speechError('canceled'));
    },
  };
}
