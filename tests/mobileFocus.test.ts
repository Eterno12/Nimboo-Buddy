import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { SqlJsModule } from '../mobile/db/sqlJsDatabase.ts';
import type { BlobStore } from '../mobile/db/persistence.ts';
import { createCore, type CoreOptions } from '../mobile/src/core.ts';
import type { Notifier } from '../mobile/src/platform/notifier.ts';

const initSqlJs = createRequire(import.meta.url)('sql.js') as () => Promise<SqlJsModule>;
const MIN = 60_000;

function blob(): BlobStore & { bytes: Uint8Array | null } {
  const b = {
    bytes: null as Uint8Array | null,
    read: async () => b.bytes,
    write: async (x: Uint8Array) => void (b.bytes = new Uint8Array(x)),
  };
  return b;
}

function fakeNotifier() {
  const calls: string[] = [];
  const n: Notifier & { calls: string[]; lastAt: number | null } = {
    calls,
    lastAt: null,
    scheduleFocusEnd: async (at, kind) => {
      n.lastAt = at;
      calls.push(`schedule:${kind}`);
    },
    cancelFocusEnd: async () => void calls.push('cancel'),
    requestPermission: async () => true,
    scheduleReminders: async () => {},
    scheduleSnooze: async () => {},
    onReminderAction: () => () => {},
  };
  return n;
}

async function open(store: BlobStore, notifier: Notifier, now: () => number) {
  const SQL = await initSqlJs();
  const opts: CoreOptions = {
    SQL,
    blob: store,
    session: { read: () => null, write: () => {}, clear: () => {} },
    fetch: async () => {
      throw new Error('sem rede');
    },
    url: 'http://127.0.0.1:1',
    anonKey: 'x',
    debounceMs: 5,
    notifier,
    now,
  };
  return createCore(opts);
}

test('foco: iniciar agenda o aviso do fim; pausar e cancelar o desfazem', async () => {
  let t = 1_000_000;
  const notifier = fakeNotifier();
  const core = await open(blob(), notifier, () => t);
  const r = core.focus.start('focus', 25);
  assert.ok(r.ok);
  assert.equal(notifier.lastAt, t + 25 * MIN);
  assert.deepEqual(notifier.calls, ['schedule:focus']);
  core.focus.pause();
  assert.equal(notifier.calls.at(-1), 'cancel');
  core.focus.resume();
  assert.equal(notifier.calls.at(-1), 'schedule:focus');
  core.focus.cancel();
  assert.equal(notifier.calls.at(-1), 'cancel');
  await core.close();
});

test('foco: a sessão sobrevive ao fechar o app e termina pelo horário real, registrando no dia', async () => {
  let t = 5_000_000;
  const store = blob();
  const first = await open(store, fakeNotifier(), () => t);
  first.focus.start('focus', 25);
  await first.flush();
  await first.close();

  t += 30 * MIN; // o app ficou fechado além do fim da sessão
  const second = await open(store, fakeNotifier(), () => t);
  const s = second.focus.getState();
  assert.equal(s.status, 'finished', 'terminou enquanto estava fechado');
  assert.deepEqual({ ...second.focusToday() }, { sessions: 1, minutes: 25 });
  await second.close();
});

test('foco: sessão em andamento é restaurada com o tempo certo', async () => {
  let t = 9_000_000;
  const store = blob();
  const first = await open(store, fakeNotifier(), () => t);
  first.focus.start('focus', 45);
  await first.flush();
  await first.close();

  t += 10 * MIN;
  const second = await open(store, fakeNotifier(), () => t);
  const s = second.focus.getState();
  assert.equal(s.status, 'running');
  assert.equal(s.endsAt, 9_000_000 + 45 * MIN);
  await second.close();
});
