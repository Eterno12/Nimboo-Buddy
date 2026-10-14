import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { matchTasks, parseAssistantCommand } from '../shared/assistant.ts';
import { AssistantHistory } from '../electron/assistant/historyStore.ts';
import { HISTORY_LIMIT } from '../shared/assistantApi.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../shared/settings.ts';

const NOW = new Date(2026, 9, 14, 10, 0, 0);
const parse = (s: string) => parseAssistantCommand(s, NOW);

test('adiar: para um dia/hora, relativo e sem prazo (amanhã por padrão)', () => {
  const a = parse('adiar enviar relatório para amanhã às 10h');
  assert.equal(a.kind, 'task.postpone');
  if (a.kind === 'task.postpone') {
    assert.equal(a.query, 'enviar relatório');
    assert.equal(new Date(a.dueAt as string).getDate(), 15);
    assert.equal(new Date(a.dueAt as string).getHours(), 10);
    assert.equal(a.minutes, null);
  }
  const b = parse('adie a tarefa pagar boleto em 2 horas');
  assert.deepEqual(b, { kind: 'task.postpone', query: 'pagar boleto', dueAt: null, whenLabel: '2 horas', minutes: 120 });
  const c = parse('adiar ligar para o João por 30 min');
  assert.equal(c.kind === 'task.postpone' && c.minutes, 30);
  assert.equal(c.kind === 'task.postpone' && c.query, 'ligar para o João');
  const d = parse('adiar lavar o carro');
  assert.deepEqual(d, { kind: 'task.postpone', query: 'lavar o carro', dueAt: null, whenLabel: null, minutes: null });
});

test('fixar e soltar nota', () => {
  assert.deepEqual(parse('fixe a nota lista de compras'), { kind: 'note.pin', query: 'lista de compras', pinned: true });
  assert.deepEqual(parse('fixar lista de compras na área de trabalho'), { kind: 'note.pin', query: 'lista de compras', pinned: true });
  assert.deepEqual(parse('solte a nota ideias'), { kind: 'note.pin', query: 'ideias', pinned: false });
  assert.notEqual(parse('fixar foco de 25 minutos').kind, 'note.pin');
});

test('o que tenho amanhã e apagar histórico', () => {
  for (const s of ['o que tenho amanhã?', 'agenda de amanhã', 'quais tarefas tenho amanhã', 'tenho algo amanhã?']) {
    assert.deepEqual(parse(s), { kind: 'list.tomorrow' }, s);
  }
  assert.equal(parse('me lembre de ligar para o João amanhã às 15h').kind, 'task.create');
  assert.equal(parse('crie uma tarefa revisar contrato amanhã').kind, 'task.create');
  for (const s of ['apagar histórico', 'limpar a conversa', 'apague o histórico do assistente', 'esqueça a conversa']) {
    assert.deepEqual(parse(s), { kind: 'history.clear' }, s);
  }
});

test('busca de notas por título reutiliza o casamento das tarefas', () => {
  const notes = [{ title: 'Lista de compras' }, { title: 'Ideias de presente' }];
  assert.deepEqual(matchTasks(notes, 'compras'), [notes[0]]);
  assert.deepEqual(matchTasks(notes, 'presente'), [notes[1]]);
  assert.deepEqual(matchTasks(notes, 'viagem'), []);
});

test('histórico: guarda, ordena, limita a 200 e apaga', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE assistant_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL CHECK (role IN ('user','assistant')), text TEXT NOT NULL, label TEXT, url TEXT, at TEXT NOT NULL);`);
  let t = 0;
  const h = new AssistantHistory(db, () => new Date(Date.UTC(2026, 9, 14, 12, 0, t++)));
  assert.deepEqual(h.list(), []);
  const saved = h.add([
    { role: 'user', text: '  oi  ' },
    { role: 'assistant', text: 'Olá!', source: { label: 'Wikipédia', url: 'https://pt.wikipedia.org/x' } },
    { role: 'robot', text: 'x' },
    { role: 'user', text: '   ' },
    { role: 'assistant', text: 'ok', source: { label: 'fonte', url: 'javascript:alert(1)' } },
    null,
  ]);
  assert.equal(saved, 3);
  const list = h.list();
  assert.deepEqual(
    list.map((e) => [e.role, e.text]),
    [['user', 'oi'], ['assistant', 'Olá!'], ['assistant', 'ok']],
  );
  assert.equal(list[1].source?.url, 'https://pt.wikipedia.org/x');
  assert.equal(list[2].source?.url, undefined, 'só http(s) é guardado');
  assert.equal(h.add('lixo'), 0);

  for (let i = 0; i < HISTORY_LIMIT + 30; i++) h.add([{ role: 'user', text: `m${i}` }]);
  const all = h.list();
  assert.equal(all.length, HISTORY_LIMIT);
  assert.equal(all[all.length - 1].text, `m${HISTORY_LIMIT + 29}`);
  assert.equal(all[0].text, 'm30');

  h.clear();
  assert.deepEqual(h.list(), []);
});

test('preferências do assistente: histórico ligado por padrão e atalho validado', () => {
  assert.equal(DEFAULT_SETTINGS.assistantHistory, true);
  assert.equal(DEFAULT_SETTINGS.assistantShortcut, null);
  assert.equal(parseSettings({ version: 3, assistantShortcut: 'Control+Alt+V' }).assistantShortcut, 'Control+Alt+V');
  assert.equal(parseSettings({ version: 3, assistantShortcut: 'Control+Alt+M' }).assistantShortcut, null, 'fora da lista');
  assert.equal(parseSettings({ version: 3, assistantHistory: false }).assistantHistory, false);
  assert.equal(parseSettings({ version: 3, assistantHistory: 'não' }).assistantHistory, true);
});
