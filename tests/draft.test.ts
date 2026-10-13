import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createIslandController } from '../src/features/island/islandController.ts';
import { draftStore, shouldHoldOpen } from '../src/features/tasks/draftStore.ts';

beforeEach(() => draftStore.reset());

test('rascunho: guarda o texto fora do componente e sobrevive a "desmontar"', () => {
  draftStore.setText('comprar pão');
  // O componente é desmontado (ilha recolhe, tela volta) e montado de novo:
  // o estado está no módulo, não no componente.
  assert.equal(draftStore.get().text, 'comprar pão');
  draftStore.setFocused(true);
  draftStore.setFocused(false); // cleanup do desmonte
  assert.equal(draftStore.get().text, 'comprar pão');
});

test('rascunho: enviar (clear) limpa o texto; foco não é alterado', () => {
  draftStore.setText('x');
  draftStore.setFocused(true);
  draftStore.clear();
  assert.equal(draftStore.get().text, '');
  assert.equal(draftStore.get().focused, true);
});

test('retenção: foco ou texto não vazio seguram a ilha; espaços não contam como rascunho', () => {
  assert.equal(shouldHoldOpen({ text: '', focused: false }), false);
  assert.equal(shouldHoldOpen({ text: '   ', focused: false }), false);
  assert.equal(shouldHoldOpen({ text: 'a', focused: false }), true);
  assert.equal(shouldHoldOpen({ text: '', focused: true }), true);
});

test('notifica ouvintes só quando algo muda', () => {
  let calls = 0;
  const off = draftStore.subscribe(() => calls++);
  draftStore.setText('a');
  draftStore.setText('a'); // igual: sem notificação
  draftStore.setFocused(true);
  assert.equal(calls, 2);
  off();
  draftStore.setText('b');
  assert.equal(calls, 2, 'cancelou a assinatura');
});

test('fluxo completo: digitar → ilha retida → recolher manualmente → reabrir com o rascunho', async () => {
  const log: string[] = [];
  let resolveOpen!: () => void;
  const island = createIslandController(
    {
      openWindow: () => new Promise<void>((r) => (resolveOpen = r)),
      closeWindow: () => log.push('closeWindow'),
      onVisualChange: (o) => log.push(o ? 'open' : 'close'),
      hide: () => log.push('hide'),
    },
    { idleMs: 50, hideMs: 100000, tickMs: 10 },
  );
  island.resume(0);
  island.expand();
  resolveOpen();
  await new Promise((r) => setTimeout(r, 5));

  // O usuário digita; a interface liga o rascunho à retenção da ilha.
  const sync = () => island.setHold(shouldHoldOpen(draftStore.get()));
  draftStore.setFocused(true);
  draftStore.setText('responder o e-mail do João');
  sync();
  await new Promise((r) => setTimeout(r, 200)); // 4x o prazo de inatividade
  assert.equal(island.isOpen(), true, 'segue aberta com rascunho');

  island.collapse(); // Esc / clique no mascote
  island.transitionEnded();
  draftStore.setFocused(false); // a tela é desmontada
  sync();
  assert.equal(island.isOpen(), false);
  assert.equal(draftStore.get().text, 'responder o e-mail do João', 'rascunho preservado ao recolher');

  island.expand();
  resolveOpen();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(island.isOpen(), true);
  assert.equal(draftStore.get().text, 'responder o e-mail do João', 'e disponível ao reabrir');
  island.dispose();
});