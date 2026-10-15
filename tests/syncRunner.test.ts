import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocalStore, Transport } from '../shared/sync/engine.ts';
import { SyncRunner } from '../electron/sync/syncRunner.ts';
import { SyncAuthError } from '../electron/sync/supabaseTransport.ts';

/** Armazenamento local mínimo: sem nada para fazer (o motor já tem seus testes). */
function emptyStore(): LocalStore {
  return {
    deviceId: () => 'dev',
    needsFullPull: () => false,
    markFullPullDone: () => {},
    cursor: () => 0,
    setCursor: () => {},
    firstSyncDone: () => true,
    markFirstSyncDone: () => {},
    enqueueAll: () => 0,
    pending: () => [],
    ack: () => {},
    readRow: () => null,
    tombstone: () => null,
    applyUpsert: () => 'applied',
    applyDelete: () => 'applied',
  };
}

const pullRows = (n: number): Transport => ({
  push: async () => 0,
  pull: async (since) =>
    since > 0
      ? []
      : Array.from({ length: n }, (_, i) => ({
          tbl: 'tasks',
          id: `00000000-0000-4000-8000-00000000000${i}`,
          deleted: false,
          stamp: '2026-10-15T10:00:00.000Z',
          origin: 'x',
          payload: { title: `t${i}` },
          server_seq: i + 1,
        })),
});

test('sucesso: guarda o horário, limpa o erro e avisa quantos registros mudaram', async () => {
  let applied = -1;
  let cursor = 0;
  const store = { ...emptyStore(), cursor: () => cursor, setCursor: (v: number) => void (cursor = v) };
  const runner = new SyncRunner({ store, transport: pullRows(3), canRun: () => true, onApplied: (n) => void (applied = n), now: () => new Date('2026-10-15T12:00:00.000Z') });
  assert.equal(runner.state().status, 'idle');
  await runner.run();
  assert.deepEqual({ ...runner.state() }, { status: 'idle', lastSync: '2026-10-15T12:00:00.000Z', error: null });
  assert.equal(applied, 3);
});

test('falha de rede vira erro legível e a próxima tentativa se recupera', async () => {
  let fail = true;
  const transport: Transport = {
    push: async () => 0,
    pull: async () => {
      if (fail) throw new Error('Sem conexão com a internet.');
      return [];
    },
  };
  const runner = new SyncRunner({ store: emptyStore(), transport, canRun: () => true });
  await runner.run();
  assert.equal(runner.state().status, 'error');
  assert.equal(runner.state().error, 'Sem conexão com a internet.');
  fail = false;
  await runner.run();
  assert.equal(runner.state().status, 'idle');
  assert.equal(runner.state().error, null);
});

test('login vencido muda para "precisa entrar" e não é tratado como falha de rede', async () => {
  const transport: Transport = {
    push: async () => 0,
    pull: async () => {
      throw new SyncAuthError();
    },
  };
  const runner = new SyncRunner({ store: emptyStore(), transport, canRun: () => true });
  await runner.run();
  assert.equal(runner.state().status, 'login');
});

test('não roda duas vezes ao mesmo tempo nem quando está desligada', async () => {
  let pulls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const transport: Transport = {
    push: async () => 0,
    pull: async () => {
      pulls++;
      await gate;
      return [];
    },
  };
  let allowed = true;
  const runner = new SyncRunner({ store: emptyStore(), transport, canRun: () => allowed });
  const a = runner.run();
  const b = runner.run();
  assert.equal(runner.state().status, 'syncing');
  release();
  await Promise.all([a, b]);
  assert.equal(pulls, 1);

  allowed = false;
  await runner.run();
  assert.equal(pulls, 1, 'desligada: não chama o servidor');
});
