import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { SqlJsModule } from '../mobile/db/sqlJsDatabase.ts';
import type { BlobStore } from '../mobile/db/persistence.ts';
import { createCore } from '../mobile/src/core.ts';
import type { WidgetBridge } from '../mobile/src/platform/widgetBridge.ts';
import type { WidgetSnapshot } from '../mobile/src/widget.ts';

const initSqlJs = createRequire(import.meta.url)('sql.js') as () => Promise<SqlJsModule>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bridge() {
  const b: WidgetBridge & { snapshots: WidgetSnapshot[]; inbox: string | null; refreshes: number; cleared: number } = {
    snapshots: [],
    inbox: null,
    refreshes: 0,
    cleared: 0,
    write: async (s) => void b.snapshots.push(s),
    refresh: async () => void b.refreshes++,
    readInbox: async () => b.inbox,
    clearInbox: async () => {
      b.cleared++;
      b.inbox = null;
    },
  };
  return b;
}

async function open(widget: WidgetBridge) {
  const blob: BlobStore = { read: async () => null, write: async () => {} };
  return createCore({
    SQL: await initSqlJs(),
    blob,
    session: { read: () => null, write: () => {}, clear: () => {} },
    fetch: async () => {
      throw new Error('sem rede');
    },
    url: 'http://127.0.0.1:1',
    anonKey: 'x',
    debounceMs: 5,
    widget,
    widgetDelayMs: 0,
  });
}

test('widget: o resumo é escrito ao abrir e a cada mudança de tarefa, e o Android é avisado', async () => {
  const w = bridge();
  const core = await open(w);
  await wait(30);
  assert.ok(w.snapshots.length >= 1, 'escreve ao abrir');
  assert.deepEqual(w.snapshots.at(-1)?.tasks, []);

  const t = await core.tasks.create('Beber água', new Date(Date.now() + 3600_000).toISOString());
  assert.ok(t.ok);
  await wait(30);
  assert.deepEqual(w.snapshots.at(-1)?.tasks.map((x) => x.title), ['Beber água']);
  assert.ok(w.refreshes >= 2);
  await core.close();
});

test('widget: "Concluir" deixado pelo widget é aplicado ao abrir e a caixa é esvaziada', async () => {
  const w = bridge();
  const first = await open(w);
  const t = await first.tasks.create('Pelo widget');
  const id = t.ok ? t.value.id : '';
  await first.close();

  const w2 = bridge();
  w2.inbox = JSON.stringify([{ action: 'complete', taskId: id }, { action: 'complete', taskId: 'lixo' }]);
  // Mesmo banco não persiste neste teste: cria de novo a tarefa e aplica a ação sobre ela.
  const core = await open(w2);
  const again = await core.tasks.create('Pelo widget');
  const id2 = again.ok ? again.value.id : '';
  w2.inbox = JSON.stringify([{ action: 'complete', taskId: id2 }]);
  await core.processWidgetInbox();
  const lists = await core.tasks.list();
  assert.deepEqual(lists.completed.map((x) => x.id), [id2]);
  assert.equal(w2.cleared, 1);
  await core.close();
});
