import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import { SqliteNotesRepository } from '../electron/notes/sqliteNotesRepository.ts';
import { applyImport, buildExport, parseExportFile } from '../electron/data/portability.ts';

const para = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-port-'));
  const db = openDatabase(path.join(dir, 'data', 'mochi.db'));
  return { db, tasks: new SqliteTaskRepository(db), notes: new SqliteNotesRepository(db), done: () => (db.close(), fs.rmSync(dir, { recursive: true, force: true })) };
}

test('exportar e importar em outro banco: tudo volta, sem duplicar na segunda vez', async () => {
  const a = fresh();
  const b = fresh();
  try {
    const t1 = await a.tasks.create('Pagar a conta', '2026-12-01T12:00:00.000Z');
    await a.tasks.create('Ligar para a Ana');
    if (t1.ok) await a.tasks.complete(t1.value.id);
    await a.notes.create({ doc: para('Ideia de presente'), color: 'blue' });
    const exported = await buildExport(a.tasks, a.notes, new Date('2026-10-13T10:00:00Z'));
    assert.equal(exported.tasks.length, 2);
    assert.equal(exported.notes.length, 1);

    const parsed = parseExportFile(JSON.stringify(exported));
    assert.ok(parsed);
    const first = await applyImport(parsed!, b.tasks, b.notes);
    assert.deepEqual(first, { tasksAdded: 2, tasksSkipped: 0, notesAdded: 1, notesSkipped: 0, invalid: 0 });
    const lists = await b.tasks.list();
    assert.equal(lists.completed.length, 1);
    assert.equal(lists.completed[0].title, 'Pagar a conta');
    assert.equal(lists.active.length, 1);
    const notes = await b.notes.list();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].color, 'blue');

    const again = await applyImport(parsed!, b.tasks, b.notes);
    assert.deepEqual(again, { tasksAdded: 0, tasksSkipped: 2, notesAdded: 0, notesSkipped: 1, invalid: 0 });
  } finally {
    a.done();
    b.done();
  }
});

test('importar: itens inválidos são ignorados e contados; arquivos que não são do Mochi são recusados', async () => {
  const x = fresh();
  try {
    const parsed = parseExportFile(
      JSON.stringify({
        app: 'mochi-desktop-buddy',
        version: 1,
        tasks: [{ title: 'boa' }, { title: '' }, { title: 'x'.repeat(500) }, 42, { title: 'prazo ruim', dueAt: 'ontem' }],
        notes: [{ doc: para('ok') }, { doc: { type: 'doc', content: [{ type: 'script' }] } }, 'texto'],
      }),
    );
    assert.ok(parsed);
    const s = await applyImport(parsed!, x.tasks, x.notes);
    assert.deepEqual(s, { tasksAdded: 1, tasksSkipped: 0, notesAdded: 1, notesSkipped: 0, invalid: 6 });
  } finally {
    x.done();
  }
  for (const bad of ['', 'nao json', '[]', '{"app":"outro","version":1}', '{"app":"mochi-desktop-buddy","version":2}', 'null']) {
    assert.equal(parseExportFile(bad), null, bad);
  }
});
