import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../shared/tasks.ts';
import { greeting, mascotMoodHint, summarize } from '../mobile/src/today.ts';

const base: Omit<Task, 'id' | 'title'> = {
  completed: false,
  createdAt: '2026-10-15T08:00:00.000Z',
  completedAt: null,
  updatedAt: '2026-10-15T08:00:00.000Z',
  dueAt: null,
  sourceRef: null,
  priority: 0,
  recurrence: null,
  parentId: null,
  position: null,
};
const t = (id: string, patch: Partial<Task> = {}): Task => ({ ...base, id, title: `Tarefa ${id}`, ...patch });
const NOW = new Date('2026-10-15T15:00:00.000Z');
const at = (iso: string) => ({ dueAt: iso });

test('resumo: separa atrasadas, de hoje e próximas; subtarefas não contam como tarefas do dia', () => {
  const tasks = [
    t('a', at('2026-10-14T12:00:00.000Z')),
    t('b', at('2026-10-15T23:00:00.000Z')),
    t('c', at('2026-10-17T12:00:00.000Z')),
    t('d'),
    t('e', { parentId: 'a', ...at('2026-10-14T10:00:00.000Z') }),
  ];
  const s = summarize(tasks, NOW);
  assert.equal(s.overdue, 1);
  assert.equal(s.today, 1);
  assert.equal(s.total, 4);
  assert.deepEqual(s.next.map((x) => x.id), ['a', 'b', 'c'], 'por prazo; sem prazo no fim e fora da lista');
});

test('próximas: no máximo 3, alta prioridade desempata prazos iguais', () => {
  const due = '2026-10-16T12:00:00.000Z';
  const tasks = [t('1', { dueAt: due }), t('2', { dueAt: due, priority: 3 }), t('3', { dueAt: due }), t('4', { dueAt: due })];
  const s = summarize(tasks, NOW);
  assert.equal(s.next.length, 3);
  assert.equal(s.next[0].id, '2');
});

test('saudação: horário do dia e frase pelo que há para fazer', () => {
  const morning = new Date(2026, 9, 15, 8, 0);
  const night = new Date(2026, 9, 15, 22, 30);
  const dawn = new Date(2026, 9, 15, 3, 0);
  assert.match(greeting(morning, { overdue: 0, today: 2, total: 5, next: [] }).title, /Bom dia/);
  assert.match(greeting(night, { overdue: 0, today: 0, total: 0, next: [] }).title, /Boa noite/);
  assert.match(greeting(dawn, { overdue: 0, today: 0, total: 0, next: [] }).title, /acordado|madrugada/i);
  assert.equal(greeting(morning, { overdue: 2, today: 0, total: 3, next: [] }).line, '2 tarefas atrasadas pedem atenção.');
  assert.equal(greeting(morning, { overdue: 1, today: 0, total: 1, next: [] }).line, '1 tarefa atrasada pede atenção.');
  assert.equal(greeting(morning, { overdue: 0, today: 3, total: 3, next: [] }).line, '3 tarefas para hoje.');
  assert.equal(greeting(morning, { overdue: 0, today: 1, total: 1, next: [] }).line, '1 tarefa para hoje.');
  assert.equal(greeting(morning, { overdue: 0, today: 0, total: 4, next: [] }).line, 'Nada urgente. Respire.');
  assert.equal(greeting(morning, { overdue: 0, today: 0, total: 0, next: [] }).line, 'Tudo em dia!');
});

test('humor do mascote: atrasadas deixam mais sério, tudo em dia deixa animado', () => {
  assert.equal(mascotMoodHint({ overdue: 3, today: 0, total: 3, next: [] }), 'low');
  assert.equal(mascotMoodHint({ overdue: 0, today: 0, total: 0, next: [] }), 'high');
  assert.equal(mascotMoodHint({ overdue: 0, today: 2, total: 2, next: [] }), 'mid');
});
