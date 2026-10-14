import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, parseAssistantCommand, parseWhen, type AssistantCommand } from '../shared/assistant.ts';

// Quarta-feira, 14 de outubro de 2026, 10:00 (horário local do teste).
const NOW = new Date(2026, 9, 14, 10, 0, 0);
const local = (y: number, mo: number, d: number, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();
const parse = (s: string): AssistantCommand => parseAssistantCommand(s, NOW);

test('fold: sem acentos e minúsculas, mantendo o comprimento (índices valem para o original)', () => {
  const s = 'Ação de São João — AMANHÃ às 15h ✓😀';
  assert.equal(fold(s).length, s.length);
  assert.equal(fold('Ação de São João'), 'acao de sao joao');
  assert.equal(fold('ÇÃO'), 'cao');
});

test('nota: várias formas de pedir, o texto mantém acentos e maiúsculas', () => {
  const cases: [string, string][] = [
    ['Crie uma nota escrito comprar pão e leite', 'comprar pão e leite'],
    ['cria uma nota: Reunião com a Ana às 14h', 'Reunião com a Ana às 14h'],
    ['Faça uma nota dizendo que o cliente aprovou', 'o cliente aprovou'],
    ['por favor, adicione uma nova nota com o texto ideias para o projeto.', 'ideias para o projeto'],
    ['anote que preciso renovar o passaporte', 'preciso renovar o passaporte'],
    ['Anota aí: senha do wifi é cafe123', 'senha do wifi é cafe123'],
    ['mochi, crie uma nota sobre a viagem de janeiro', 'a viagem de janeiro'],
    ['Nota: lembrar de regar as plantas', 'lembrar de regar as plantas'],
  ];
  for (const [input, text] of cases) {
    assert.deepEqual(parse(input), { kind: 'note.create', text }, input);
  }
});

test('tarefa: título limpo e prazo reconhecido (hoje, amanhã, hora, dia da semana, relativo)', () => {
  assert.deepEqual(parse('Me lembre de ligar para o João amanhã às 15h'), {
    kind: 'task.create',
    title: 'Ligar para o João',
    dueAt: local(2026, 10, 15, 15, 0),
    whenLabel: 'amanhã às 15:00',
  });
  assert.deepEqual(parse('crie uma tarefa enviar relatório hoje às 18:30'), {
    kind: 'task.create',
    title: 'Enviar relatório',
    dueAt: local(2026, 10, 14, 18, 30),
    whenLabel: 'hoje às 18:30',
  });
  assert.deepEqual(parse('adicione pagar a conta de luz nas tarefas'), {
    kind: 'task.create',
    title: 'Pagar a conta de luz',
    dueAt: null,
    whenLabel: null,
  });
  assert.deepEqual(parse('preciso comprar café em 30 minutos'), {
    kind: 'task.create',
    title: 'Comprar café',
    dueAt: new Date(2026, 9, 14, 10, 30).toISOString(),
    whenLabel: 'em 30 minuto(s)',
  });
  const week = parse('lembra de estudar na sexta às 9h');
  assert.equal(week.kind, 'task.create');
  if (week.kind === 'task.create') {
    assert.equal(week.title, 'Estudar');
    assert.equal(week.dueAt, local(2026, 10, 16, 9, 0));
  }
});

test('prazo: só a hora = hoje (ou amanhã se já passou); dia sem hora = 09:00; dia do mês', () => {
  assert.equal(parseWhen('ligar às 15h', NOW).dueAt, local(2026, 10, 14, 15, 0));
  assert.equal(parseWhen('ligar às 8h', NOW).dueAt, local(2026, 10, 15, 8, 0), '8h já passou: amanhã');
  assert.equal(parseWhen('revisar amanhã', NOW).dueAt, local(2026, 10, 15, 9, 0));
  assert.equal(parseWhen('revisar depois de amanhã às 7 da noite', NOW).dueAt, local(2026, 10, 16, 19, 0));
  assert.equal(parseWhen('pagar dia 20', NOW).dueAt, local(2026, 10, 20, 9, 0));
  assert.equal(parseWhen('pagar dia 5', NOW).dueAt, local(2026, 11, 5, 9, 0), 'dia 5 já passou: mês que vem');
  assert.equal(parseWhen('pagar dia 3 de dezembro', NOW).dueAt, local(2026, 12, 3, 9, 0));
  assert.equal(parseWhen('almoço ao meio-dia', NOW).dueAt, local(2026, 10, 14, 12, 0), 'meio-dia ainda não passou');
  assert.equal(parseWhen('sem prazo nenhum', NOW).dueAt, null);
  assert.equal(parseWhen('às 25h', NOW).dueAt, null, 'hora impossível é ignorada');
});

test('listas e abrir: tarefas, agenda, notas, configurações', () => {
  for (const s of ['quais são minhas tarefas?', 'listar tarefas', 'o que tenho pra fazer', 'minhas tarefas', 'mostre as tarefas']) {
    assert.deepEqual(parse(s), { kind: 'list.tasks' }, s);
  }
  for (const s of ['o que tenho hoje na agenda?', 'agenda de hoje', 'quais são meus compromissos de hoje']) {
    assert.deepEqual(parse(s), { kind: 'list.agenda' }, s);
  }
  for (const s of ['minhas notas', 'listar notas', 'quais são as minhas notas']) {
    assert.deepEqual(parse(s), { kind: 'list.notes' }, s);
  }
  assert.deepEqual(parse('abrir as notas'), { kind: 'open.notes' });
  assert.deepEqual(parse('abra a janela de notas'), { kind: 'open.notes' });
  assert.deepEqual(parse('abrir configurações'), { kind: 'open.settings' });
});

test('concluir tarefa guarda o trecho a procurar (com os acentos originais)', () => {
  assert.deepEqual(parse('concluir tarefa enviar relatório'), { kind: 'task.complete', query: 'enviar relatório' });
  assert.deepEqual(parse('terminei de pagar a conta de luz'), { kind: 'task.complete', query: 'pagar a conta de luz' });
  assert.deepEqual(parse('marque ligar para o João como feita'), { kind: 'task.complete', query: 'ligar para o João' });
});

test('foco: iniciar (com ou sem minutos), pausar, retomar, cancelar', () => {
  assert.deepEqual(parse('iniciar foco de 25 minutos'), { kind: 'focus.start', minutes: 25 });
  assert.deepEqual(parse('quero focar por 50 minutos'), { kind: 'focus.start', minutes: 50 });
  assert.deepEqual(parse('começar um pomodoro'), { kind: 'focus.start', minutes: null });
  assert.deepEqual(parse('iniciar foco de 2 horas'), { kind: 'focus.start', minutes: 120 });
  assert.deepEqual(parse('iniciar foco de 500 minutos'), { kind: 'focus.start', minutes: null }, 'fora do limite: usa o padrão');
  assert.deepEqual(parse('pausar o foco'), { kind: 'focus.pause' });
  assert.deepEqual(parse('retomar o foco'), { kind: 'focus.resume' });
  assert.deepEqual(parse('cancelar o foco'), { kind: 'focus.cancel' });
});

test('personagem: troca pelo nome (com artigo)', () => {
  assert.deepEqual(parse('mudar para o cacto'), { kind: 'character.set', id: 'cactus' });
  assert.deepEqual(parse('troque para o fantasma'), { kind: 'character.set', id: 'ghost' });
  assert.deepEqual(parse('quero o abacaxi'), { kind: 'character.set', id: 'pineapple' });
  assert.deepEqual(parse('mude para o quadradinho'), { kind: 'character.set', id: 'square' });
  assert.deepEqual(parse('volte para o Mochi'), { kind: 'ask', question: 'volte para o Mochi' }, 'sem verbo reconhecido vira pergunta');
});

test('ajuda, saudação e perguntas livres', () => {
  assert.deepEqual(parse('ajuda'), { kind: 'help' });
  assert.deepEqual(parse('o que você consegue fazer?'), { kind: 'help' });
  assert.deepEqual(parse('Oi, Mochi!'), { kind: 'greeting' });
  assert.deepEqual(parse('quem descobriu o Brasil?'), { kind: 'ask', question: 'quem descobriu o Brasil?' });
  assert.deepEqual(parse('qual é a capital da Austrália'), { kind: 'ask', question: 'qual é a capital da Austrália' });
  assert.deepEqual(parse('   '), { kind: 'ask', question: '' });
});

test('robustez: entradas estranhas nunca lançam e comandos vazios viram pergunta', () => {
  for (const s of ['crie uma nota', 'crie uma tarefa', 'anote', '😀😀😀', 'a'.repeat(5000), '\n\t', 'crie uma nota ' + 'x'.repeat(3000), 'lembre-me de', '__proto__', 'concluir tarefa']) {
    const r = parse(s);
    assert.ok(typeof r.kind === 'string', s.slice(0, 20));
    if (r.kind === 'note.create') assert.ok(r.text.length > 0 || s === 'crie uma nota');
  }
  // "crie uma nota" sem texto: o comando existe, com texto vazio (a interface pede o conteúdo)
  assert.deepEqual(parse('crie uma nota'), { kind: 'note.create', text: '' });
});


test('estatísticas da semana: formas de pedir e sem confundir com criar algo', () => {
  for (const s of ['minha semana', 'estatísticas', 'como foi minha semana?', 'mostrar estatísticas', 'desempenho']) {
    assert.deepEqual(parse(s), { kind: 'stats' }, s);
  }
  assert.equal(parse('crie uma tarefa revisar a semana').kind, 'task.create');
});

test('conquistas: formas de pedir e sem confundir com criar algo', () => {
  for (const s of ['minhas conquistas', 'conquistas', 'mostrar conquistas', 'ver meus troféus', 'quais são minhas conquistas?']) {
    assert.deepEqual(parse(s), { kind: 'achievements' }, s);
  }
  assert.equal(parse('crie uma tarefa para ver as conquistas').kind, 'task.create');
});

test('resumo do dia: várias formas de pedir', () => {
  for (const s of ['resumo do dia', 'como foi o meu dia?', 'resumo de hoje', 'fechamento', 'como está o meu dia', 'resumo']) {
    assert.deepEqual(parse(s), { kind: 'summary' }, s);
  }
  // não confunde com "agenda de hoje" nem com criar tarefa
  assert.deepEqual(parse('agenda de hoje'), { kind: 'list.agenda' });
  assert.equal(parse('crie uma tarefa fazer o resumo do dia').kind, 'task.create');
});
