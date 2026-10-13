import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { currentVersion, MIGRATIONS } from '../electron/tasks/migrations.ts';
import { SqliteNotesRepository } from '../electron/notes/sqliteNotesRepository.ts';
import { SqliteTaskRepository } from '../electron/tasks/sqliteTaskRepository.ts';
import {
  NOTE_LIMIT,
  NOTE_TITLE_MAX,
  NOTE_UNTITLED,
  describeNote,
  emptyNoteDoc,
  likePattern,
  validateBounds,
  validateNoteDoc,
  type NoteChange,
  type NoteDoc,
} from '../shared/notes.ts';

const p = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: 'paragraph',
  content: [marks ? { type: 'text', text, marks } : { type: 'text', text }],
});
const doc = (...content: unknown[]) => ({ type: 'doc', content });

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-notes-'));
  const file = path.join(dir, 'data', 'mochi.db');
  const db = openDatabase(file);
  const events: NoteChange[] = [];
  let n = 0;
  let t = new Date('2026-04-01T10:00:00.000Z').getTime();
  const repo = new SqliteNotesRepository(db, {
    now: () => new Date(t),
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    onChange: (e) => events.push(e),
  });
  return {
    dir,
    file,
    db,
    repo,
    events,
    advance: (ms: number) => (t += ms),
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* já fechado */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---- Documento --------------------------------------------------------------

test('documento: aceita a formatação completa (negrito, cores, listas, tarefas, citação, código, alinhamento)', () => {
  const input = doc(
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'Título' }] },
    p('negrito', [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }]),
    p('cor', [{ type: 'textStyle', attrs: { color: '#c0392b' } }, { type: 'highlight', attrs: { color: '#ffe066' } }]),
    p('link', [{ type: 'link', attrs: { href: 'https://example.com/a?b=1' } }]),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('um')] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p('três')] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('feito')] }] },
    { type: 'blockquote', content: [p('citação')] },
    { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1;' }] },
    { type: 'horizontalRule' },
  );
  const r = validateNoteDoc(input);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value, input, 'o que é permitido passa sem alteração');
});

test('documento: atributos e marcas não permitidos são removidos; tipos desconhecidos são recusados', () => {
  const r = validateNoteDoc(
    doc({
      type: 'paragraph',
      attrs: { textAlign: 'center', onclick: 'alert(1)', style: 'x' },
      content: [
        {
          type: 'text',
          text: 'oi',
          marks: [
            { type: 'bold', attrs: { evil: true } },
            { type: 'fontSize', attrs: { size: '999px' } },
            { type: 'link', attrs: { href: 'javascript:alert(1)' } },
            { type: 'textStyle', attrs: { color: 'url(javascript:x)' } },
            { type: 'highlight', attrs: { color: 'red; background:url(x)' } },
          ],
        },
      ],
    }),
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  const para = r.value.content[0];
  assert.deepEqual(para.attrs, { textAlign: 'center' });
  assert.deepEqual(para.content?.[0].marks, [{ type: 'bold' }, { type: 'highlight' }]);

  for (const bad of [
    doc({ type: 'image', attrs: { src: 'file:///c:/x.png' } }),
    doc({ type: 'script', content: [] }),
    doc({ type: '__proto__' }),
    doc({ type: 'constructor' }),
    doc({ type: 'doc', content: [] }),
    doc({ type: 'listItem', content: [p('solto')] }), // item fora de lista
    doc({ type: 'bulletList', content: [p('parágrafo direto na lista')] }),
    doc({ type: 'paragraph', content: [{ type: 'bulletList' }] }),
    doc({ type: 'codeBlock', content: [{ type: 'hardBreak' }] }),
  ]) {
    assert.equal(validateNoteDoc(bad).ok, false, JSON.stringify(bad).slice(0, 80));
  }
  for (const bad of [null, undefined, 42, 'texto', [], {}, { type: 'paragraph' }]) {
    assert.equal(validateNoteDoc(bad).ok, false, JSON.stringify(bad));
  }
});

test('documento: links só http/https/mailto; cores só hexadecimais de 6 dígitos; nível de título corrigido', () => {
  const marks = (href: string) => [{ type: 'link', attrs: { href } }];
  const get = (href: string) => {
    const r = validateNoteDoc(doc(p('x', marks(href))));
    return r.ok ? r.value.content[0].content?.[0].marks : 'erro';
  };
  assert.equal(get('https://a.com')?.length, 1);
  assert.equal(get('mailto:a@b.com')?.length, 1);
  assert.equal(get('http://a.com')?.length, 1);
  assert.equal(get('javascript:alert(1)'), undefined);
  assert.equal(get('data:text/html,<script>'), undefined);
  assert.equal(get('file:///c:/windows/system32/cmd.exe'), undefined);
  assert.equal(get('//evil.com'), undefined);
  const h = validateNoteDoc(doc({ type: 'heading', attrs: { level: 9 }, content: [{ type: 'text', text: 'a' }] }));
  assert.ok(h.ok && h.value.content[0].attrs?.level === 2);
});

test('documento: limites de profundidade, nós e tamanho; vazio vira um parágrafo; texto vazio é descartado', () => {
  let deep: unknown = p('fundo');
  for (let i = 0; i < 20; i++) deep = { type: 'blockquote', content: [deep] };
  assert.equal(validateNoteDoc(doc(deep)).ok, false, 'aninhamento excessivo');

  const many = doc(...Array.from({ length: 21_000 }, () => ({ type: 'horizontalRule' })));
  assert.equal(validateNoteDoc(many).ok, false, 'nós demais');

  const huge = doc(...Array.from({ length: 30 }, () => p('a'.repeat(4000))));
  assert.equal(validateNoteDoc(huge).ok, false, 'texto demais');

  const empty = validateNoteDoc(doc());
  assert.ok(empty.ok && empty.value.content.length === 1 && empty.value.content[0].type === 'paragraph');
  const blank = validateNoteDoc(doc({ type: 'paragraph', content: [{ type: 'text', text: '' }] }));
  assert.ok(blank.ok && blank.value.content[0].content === undefined);
});

test('descrever: título = primeira linha (cortada), prévia = as seguintes, vazio = "Nota sem título"', () => {
  const d = doc(
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Compras' }] },
    { type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: false }, content: [p('leite')] },
      { type: 'taskItem', attrs: { checked: true }, content: [p('pão')] },
    ] },
  ) as NoteDoc;
  const m = describeNote(d);
  assert.equal(m.title, 'Compras');
  assert.equal(m.preview, 'leite · pão');
  assert.equal(m.plain, 'Compras\nleite\npão');
  assert.equal(describeNote(emptyNoteDoc()).title, NOTE_UNTITLED);
  const long = describeNote(doc(p('x'.repeat(500))) as NoteDoc);
  assert.ok([...long.title].length <= NOTE_TITLE_MAX && long.title.endsWith('…'));
});

test('busca: o padrão LIKE escapa %, _ e barra', () => {
  assert.equal(likePattern(' 50% de_desconto '), '%50\\% de\\_desconto%');
  assert.equal(likePattern('a\\b'), '%a\\\\b%');
});

test('janela: posição e tamanho validados (nulo apaga; absurdos são recusados)', () => {
  assert.deepEqual(validateBounds({ x: 10.4, y: -5, width: 300, height: 200 }), { ok: true, value: { x: 10, y: -5, width: 300, height: 200 } });
  assert.deepEqual(validateBounds(null), { ok: true, value: null });
  for (const bad of [{ x: 1, y: 1, width: 10, height: 200 }, { x: NaN, y: 0, width: 300, height: 200 }, { x: 0, y: 0, width: 300 }, 'x', []]) {
    assert.equal(validateBounds(bad).ok, false, JSON.stringify(bad));
  }
});

// ---- Repositório ------------------------------------------------------------

test('banco: a migração v4 cria a tabela de notas e preserva as tarefas existentes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-notes-mig-'));
  const file = path.join(dir, 'mochi.db');
  try {
    const v3 = openDatabase(file, { migrations: MIGRATIONS.slice(0, 3) });
    await new SqliteTaskRepository(v3).create('antiga');
    v3.close();
    const db = openDatabase(file);
    try {
      assert.equal(currentVersion(db), MIGRATIONS.length);
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'notes'").get());
      assert.equal((await new SqliteTaskRepository(db).list()).active.length, 1);
      assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('mochi.db.bak-v3-')), 'backup antes de migrar');
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('notas: criar, ler, listar (mais recente primeiro) e buscar', async () => {
  const t = setup();
  try {
    const a = await t.repo.create({ doc: doc(p('Receita de bolo'), p('3 ovos e farinha')) });
    t.advance(1000);
    const b = await t.repo.create({ doc: doc(p('Reunião de segunda')), color: 'blue' });
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.equal(a.value.title, 'Receita de bolo');
    assert.equal(a.value.color, 'yellow');
    assert.equal(b.value.color, 'blue');
    const list = await t.repo.list();
    assert.deepEqual(list.map((n) => n.title), ['Reunião de segunda', 'Receita de bolo']);
    assert.equal(list[1].preview, '3 ovos e farinha');
    assert.deepEqual((await t.repo.list('ovos')).map((n) => n.title), ['Receita de bolo']);
    assert.deepEqual((await t.repo.list('REUNIÃO')).map((n) => n.title), ['Reunião de segunda'], 'sem diferenciar maiúsculas');
    assert.deepEqual((await t.repo.list('reuniao')).map((n) => n.title), ['Reunião de segunda'], 'sem diferenciar acentos');
    assert.equal((await t.repo.list('%')).length, 0, '% é literal, não curinga');
    const got = await t.repo.get(a.value.id);
    assert.ok(got.ok && got.value.doc.content.length === 2);
  } finally {
    t.cleanup();
  }
});

test('notas: editar o conteúdo atualiza título/prévia e a ordem; mover a janela e fixar não alteram a data', async () => {
  const t = setup();
  try {
    const a = await t.repo.create({ doc: doc(p('Antes')) });
    assert.ok(a.ok);
    if (!a.ok) return;
    t.advance(5000);
    const edited = await t.repo.update(a.value.id, { doc: doc(p('Depois'), p('detalhe')) });
    assert.ok(edited.ok);
    if (!edited.ok) return;
    assert.equal(edited.value.title, 'Depois');
    assert.notEqual(edited.value.updatedAt, a.value.updatedAt);
    t.advance(5000);
    const pinned = await t.repo.update(a.value.id, { pinned: true, bounds: { x: 40, y: 50, width: 320, height: 260 } });
    assert.ok(pinned.ok);
    if (!pinned.ok) return;
    assert.equal(pinned.value.pinned, true);
    assert.deepEqual(pinned.value.bounds, { x: 40, y: 50, width: 320, height: 260 });
    assert.equal(pinned.value.updatedAt, edited.value.updatedAt, 'fixar/mover não conta como edição');
    assert.equal((await t.repo.pinned()).length, 1);
    const unpinned = await t.repo.update(a.value.id, { pinned: false });
    assert.ok(unpinned.ok && unpinned.value.bounds !== null, 'a última posição é lembrada');
    assert.equal((await t.repo.pinned()).length, 0);
    assert.deepEqual(t.events.at(-1), { type: 'updated', id: a.value.id, fields: ['pinned'] });
  } finally {
    t.cleanup();
  }
});

test('notas: entradas inválidas são recusadas sem alterar nada', async () => {
  const t = setup();
  try {
    const a = await t.repo.create({ doc: doc(p('Boa')) });
    assert.ok(a.ok);
    if (!a.ok) return;
    const id = a.value.id;
    const bad: [string, unknown][] = [
      ['doc', { type: 'doc', content: [{ type: 'iframe' }] }],
      ['color', 'neon'],
      ['pinned', 'sim'],
      ['bounds', { x: 0, y: 0, width: 5, height: 5 }],
    ];
    for (const [key, value] of bad) {
      const r = await t.repo.update(id, { [key]: value });
      assert.equal(r.ok, false, key);
    }
    assert.equal((await t.repo.update('nao-e-id', { color: 'blue' })).ok, false);
    assert.equal((await t.repo.create({ doc: { type: 'x' } })).ok, false);
    assert.equal((await t.repo.create({ color: 'x' })).ok, false);
    const same = await t.repo.get(id);
    assert.ok(same.ok && same.value.title === 'Boa' && same.value.color === 'yellow');
    assert.equal(t.events.filter((e) => e.type === 'updated').length, 0);
  } finally {
    t.cleanup();
  }
});

test('notas: excluir avisa; excluir de novo é "não encontrada"; limite de notas', async () => {
  const t = setup();
  try {
    const a = await t.repo.create();
    assert.ok(a.ok);
    if (!a.ok) return;
    assert.ok((await t.repo.remove(a.value.id)).ok);
    assert.deepEqual(t.events.at(-1), { type: 'removed', id: a.value.id });
    const again = await t.repo.remove(a.value.id);
    assert.equal(again.ok, false);
    assert.equal((await t.repo.get(a.value.id)).ok, false);

    // limite: preenche direto no banco e confere a recusa
    const stmt = t.db.prepare(
      "INSERT INTO notes (id, title, preview, plain, doc, color, pinned, created_at, updated_at) VALUES (?, 't', '', '', '{}', 'yellow', 0, 'x', 'x')",
    );
    t.db.exec('BEGIN');
    for (let i = 0; i < NOTE_LIMIT; i++) stmt.run(`00000000-0000-4000-9000-${String(i).padStart(12, '0')}`);
    t.db.exec('COMMIT');
    const r = await t.repo.create();
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'limit_reached');
  } finally {
    t.cleanup();
  }
});

test('notas: um documento corrompido no banco abre vazio em vez de quebrar', async () => {
  const t = setup();
  try {
    t.db
      .prepare(
        "INSERT INTO notes (id, title, preview, plain, doc, color, pinned, created_at, updated_at) VALUES ('11111111-1111-4111-8111-111111111111', 'x', '', '', '{nao e json', 'rosa', 0, 'x', 'x')",
      )
      .run();
    const r = await t.repo.get('11111111-1111-4111-8111-111111111111');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.value.doc, emptyNoteDoc());
    assert.equal(r.value.color, 'yellow', 'cor inválida volta ao padrão');
  } finally {
    t.cleanup();
  }
});
