import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { SyncStore } from '../electron/sync/syncStore.ts';
import { syncOnce, type SyncRow, type Transport } from '../shared/sync/engine.ts';

/** Servidor falso com a MESMA regra de conflito do SQL (supabase/migrations/0001_sync.sql). */
class FakeServer {
  rows = new Map<string, SyncRow & { server_seq: number }>();
  seq = 0;
  failNext = 0;
  pushes = 0;

  transport(): Transport {
    return {
      push: async (batch) => {
        if (this.failNext > 0) {
          this.failNext--;
          throw new Error('sem rede');
        }
        this.pushes++;
        for (const r of batch) {
          const key = `${r.tbl}:${r.id}`;
          const cur = this.rows.get(key);
          const wins =
            !cur ||
            r.stamp > cur.stamp ||
            (r.stamp === cur.stamp && r.deleted && !cur.deleted) ||
            (r.stamp === cur.stamp && r.deleted === cur.deleted && r.origin > cur.origin);
          if (wins) this.rows.set(key, { ...r, payload: r.deleted ? null : r.payload, server_seq: ++this.seq });
        }
        return this.seq;
      },
      pull: async (since, limit) => {
        if (this.failNext > 0) {
          this.failNext--;
          throw new Error('sem rede');
        }
        return [...this.rows.values()].filter((r) => r.server_seq > since).sort((a, b) => a.server_seq - b.server_seq).slice(0, limit);
      },
    };
  }
}

function device(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nimboo-eng-${name}-`));
  const db = openDatabase(path.join(dir, 'mochi.db'));
  let clock = new Date('2026-10-15T12:00:00.000Z');
  const tasks = new SqliteTaskRepository(db, { now: () => clock });
  return {
    db,
    tasks,
    store: new SyncStore(db),
    tick: (ms = 1000) => (clock = new Date(clock.getTime() + ms)),
    titles: async () => (await tasks.list()).active.map((t) => t.title).sort(),
    done: () => (db.close(), fs.rmSync(dir, { recursive: true, force: true })),
  };
}

test('dois aparelhos convergem: o que um cria o outro recebe, sem eco', async () => {
  const server = new FakeServer();
  const a = device('a');
  const b = device('b');
  try {
    await a.tasks.create('Comprar pão');
    await a.tasks.create('Estudar');
    await syncOnce(a.store, server.transport());
    const result = await syncOnce(b.store, server.transport());
    assert.deepEqual(await b.titles(), ['Comprar pão', 'Estudar']);
    assert.equal(result.applied, 2);
    assert.equal(b.store.pending().length, 0, 'o que veio da nuvem não volta para a fila');
    const again = await syncOnce(b.store, server.transport());
    assert.deepEqual([again.pulled, again.pushed], [0, 0], 'idempotente');
  } finally {
    a.done();
    b.done();
  }
});

test('edição mais nova vence nos dois lados e exclusão não ressuscita', async () => {
  const server = new FakeServer();
  const a = device('a');
  const b = device('b');
  try {
    const t = await a.tasks.create('Original');
    const id = t.ok ? t.value.id : '';
    await syncOnce(a.store, server.transport());
    await syncOnce(b.store, server.transport());

    a.tick(5000);
    await a.tasks.update(id, { title: 'Editada no A' });
    b.tick(9000);
    await b.tasks.update(id, { title: 'Editada no B (mais nova)' });
    await syncOnce(a.store, server.transport());
    await syncOnce(b.store, server.transport());
    await syncOnce(a.store, server.transport());
    assert.deepEqual(await a.titles(), ['Editada no B (mais nova)']);
    assert.deepEqual(await b.titles(), ['Editada no B (mais nova)']);

    b.tick(5000);
    await b.tasks.remove(id);
    await syncOnce(b.store, server.transport());
    await syncOnce(a.store, server.transport());
    assert.deepEqual(await a.titles(), [], 'exclusão chegou');
    await syncOnce(a.store, server.transport());
    await syncOnce(b.store, server.transport());
    assert.deepEqual(await b.titles(), [], 'ninguém ressuscitou');
  } finally {
    a.done();
    b.done();
  }
});

test('sem rede: nada se perde; a fila é enviada quando a conexão volta', async () => {
  const server = new FakeServer();
  const a = device('a');
  try {
    await a.tasks.create('Feita offline');
    server.failNext = 1;
    await assert.rejects(() => syncOnce(a.store, server.transport()), /sem rede/);
    assert.equal(a.store.pending().length, 1, 'continua na fila');
    const ok = await syncOnce(a.store, server.transport());
    assert.equal(ok.pushed, 1);
    assert.equal(a.store.pending().length, 0);
    assert.equal(server.rows.size, 1);
  } finally {
    a.done();
  }
});

test('primeira sincronização envia o que já existia; banco recuperado baixa antes de enviar', async () => {
  const server = new FakeServer();
  const first = device('first');
  const fresh = device('fresh');
  try {
    first.db.exec('UPDATE sync_ctx SET suppress = 1');
    first.db.prepare("INSERT INTO tasks (id, title, completed, created_at, updated_at) VALUES ('33333333-3333-4333-8333-333333333333', 'Antiga', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')").run();
    first.db.exec('UPDATE sync_ctx SET suppress = 0');
    assert.equal(first.store.pending().length, 0);
    await syncOnce(first.store, server.transport());
    assert.equal(server.rows.size, 1, 'registro antigo subiu na 1ª sincronização');

    // Aparelho recuperado de corrupção: vazio, mas com uma tarefa criada depois e needs_full_pull ligado.
    fresh.db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('needs_full_pull', '1')").run();
    await fresh.tasks.create('Nova depois do desastre');
    const order: string[] = [];
    const t = server.transport();
    const spy: Transport = {
      pull: async (...args) => (order.push('pull'), t.pull(...args)),
      push: async (...args) => (order.push('push'), t.push(...args)),
    };
    await syncOnce(fresh.store, spy);
    assert.ok(order.indexOf('pull') < order.indexOf('push'), `ordem ${order.join(',')}`);
    assert.equal(fresh.store.needsFullPull(), false);
    assert.deepEqual(await fresh.titles(), ['Antiga', 'Nova depois do desastre']);
  } finally {
    first.done();
    fresh.done();
  }
});
