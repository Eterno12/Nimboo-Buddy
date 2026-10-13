import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  isFullscreenState,
  NOTIFICATION_STATE,
  parseStateLine,
  startFullscreenWatcher,
  watcherScript,
} from '../electron/dnd.ts';

test('estados: só tela cheia/apresentação escondem; normal, assistente de foco e tela bloqueada não', () => {
  assert.equal(isFullscreenState(NOTIFICATION_STATE.BUSY), true);
  assert.equal(isFullscreenState(NOTIFICATION_STATE.D3D_FULL_SCREEN), true);
  assert.equal(isFullscreenState(NOTIFICATION_STATE.PRESENTATION_MODE), true);
  assert.equal(isFullscreenState(NOTIFICATION_STATE.APP), true);
  assert.equal(isFullscreenState(NOTIFICATION_STATE.ACCEPTS_NOTIFICATIONS), false);
  assert.equal(isFullscreenState(NOTIFICATION_STATE.QUIET_TIME), false);
  assert.equal(isFullscreenState(NOTIFICATION_STATE.NOT_PRESENT), false);
  assert.equal(isFullscreenState(0), false);
  assert.equal(isFullscreenState(99), false);
});

test('parseStateLine: aceita só "STATE n"; lixo e ruído do PowerShell são ignorados', () => {
  assert.equal(parseStateLine('STATE 2'), 2);
  assert.equal(parseStateLine('  STATE 5\r'), 5);
  for (const bad of ['', 'STATE', 'STATE x', 'state 2', 'Erro ao carregar', 'STATE 2 3', 'STATE 123']) {
    assert.equal(parseStateLine(bad), null, bad);
  }
});

test('script: consulta o shell, sai se o app pai sumir e usa o intervalo pedido', () => {
  const s = watcherScript(4321, 1500);
  assert.match(s, /SHQueryUserNotificationState/);
  assert.match(s, /Get-Process -Id 4321/);
  assert.match(s, /Start-Sleep -Milliseconds 1500/);
});

function fakeSpawn() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    killed: boolean;
    kill(): void;
  };
  child.stdout = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return child;
  }) as unknown as typeof import('node:child_process').spawn;
  return { child, calls, spawn };
}

test('vigia: avisa só quando muda, junta pedaços de linha e ignora estados repetidos', () => {
  const f = fakeSpawn();
  const seen: boolean[] = [];
  startFullscreenWatcher({ spawn: f.spawn, onChange: (v) => seen.push(v) });
  assert.equal(f.calls[0].cmd, 'powershell.exe');
  assert.ok(f.calls[0].args.includes('-Command'));
  assert.ok(!f.calls[0].args.includes('-EncodedCommand'), 'sem comando codificado (parece malware para antivírus)');
  assert.ok(!f.calls[0].args.includes('-ExecutionPolicy'), 'não mexe na política de execução');
  f.child.stdout.emit('data', Buffer.from('STATE 5\n'));
  assert.deepEqual(seen, [], 'normal desde o início: nada a avisar');
  f.child.stdout.emit('data', Buffer.from('STA'));
  f.child.stdout.emit('data', Buffer.from('TE 2\r\nSTATE 3\n'));
  assert.deepEqual(seen, [true], 'BUSY → D3D continuam sendo "tela cheia": um aviso só');
  f.child.stdout.emit('data', Buffer.from('lixo\nSTATE 5\n'));
  assert.deepEqual(seen, [true, false]);
});

test('vigia: stop encerra o processo e silencia avisos; erro ao iniciar não derruba o app', () => {
  const f = fakeSpawn();
  const seen: boolean[] = [];
  const w = startFullscreenWatcher({ spawn: f.spawn, onChange: (v) => seen.push(v) });
  f.child.emit('error', new Error('powershell ausente')); // só registra
  w.stop();
  assert.equal(f.child.killed, true);
  f.child.stdout.emit('data', Buffer.from('STATE 2\n'));
  assert.deepEqual(seen, []);
});
