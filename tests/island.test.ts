import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createIslandController } from '../src/features/island/islandController.ts';

/** Cria o controlador com dependências espiãs e um `openWindow` controlável. */
function setup() {
  const log: string[] = [];
  let release!: () => void;
  const deps = {
    openWindow: () =>
      new Promise<void>((resolve) => {
        log.push('openWindow');
        release = resolve;
      }),
    closeWindow: () => log.push('closeWindow'),
    onVisualChange: (open: boolean) => log.push(open ? 'visual:open' : 'visual:close'),
    hide: () => log.push('hide'),
  };
  const c = createIslandController(deps, { idleMs: 8000, hideMs: 3000, closeFallbackMs: 450, tickMs: 250 });
  c.resume(0);
  return { c, log, resolveOpen: () => release() };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

test('expandir: a janela cresce antes do visual abrir', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  assert.deepEqual(log, ['openWindow']); // visual ainda não abriu
  resolveOpen();
  await flush();
  assert.deepEqual(log, ['openWindow', 'visual:open']);
  assert.equal(c.isOpen(), true);
  c.dispose();
  mock.timers.reset();
});

test('recolher: visual fecha primeiro; a janela só encolhe no fim da transição', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  log.length = 0;
  c.collapse();
  assert.deepEqual(log, ['visual:close']);
  c.transitionEnded();
  assert.deepEqual(log, ['visual:close', 'closeWindow']);
  c.dispose();
  mock.timers.reset();
});

test('recolher: sem transitionend, o tempo limite encolhe a janela', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  log.length = 0;
  c.collapse();
  mock.timers.tick(449);
  assert.ok(!log.includes('closeWindow'));
  mock.timers.tick(2);
  assert.deepEqual(log, ['visual:close', 'closeWindow']);
  c.dispose();
  mock.timers.reset();
});

test('reabrir durante o recolhimento não encolhe nem recria a janela', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  log.length = 0;
  c.collapse();
  c.expand(); // ainda ampliada
  mock.timers.tick(1000);
  c.transitionEnded();
  assert.deepEqual(log, ['visual:close', 'visual:open']);
  assert.equal(c.isOpen(), true);
  c.dispose();
  mock.timers.reset();
});

test('desistir enquanto a janela cresce: encolhe sem abrir o visual', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  c.collapse();
  assert.deepEqual(log, ['openWindow']);
  resolveOpen();
  await flush();
  assert.deepEqual(log, ['openWindow', 'closeWindow']);
  assert.equal(c.isOpen(), false);
  c.dispose();
  mock.timers.reset();
});

test('cliques rápidos (toggle x5) terminam consistentes', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  for (let i = 0; i < 5; i++) c.toggle();
  resolveOpen();
  await flush();
  // 5 toggles => aberto; janela aberta uma única vez.
  assert.equal(c.isOpen(), true);
  assert.equal(log.filter((l) => l === 'openWindow').length, 1);
  assert.equal(log.filter((l) => l === 'closeWindow').length, 0);
  c.dispose();
  mock.timers.reset();
});

test('recolhe sozinho após 8 s de inatividade', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  log.length = 0;
  mock.timers.tick(7500);
  assert.equal(c.isOpen(), true);
  mock.timers.tick(750);
  assert.equal(c.isOpen(), false);
  assert.deepEqual(log, ['visual:close']);
  c.dispose();
  mock.timers.reset();
});

test('atividade reinicia o contador e hover o pausa', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  mock.timers.tick(6000);
  c.activity();
  mock.timers.tick(6000); // 12 s no total, mas só 6 s desde a atividade
  assert.equal(c.isOpen(), true);
  c.setHover(true);
  mock.timers.tick(60_000); // hover: nunca recolhe
  assert.equal(c.isOpen(), true);
  c.setHover(false);
  mock.timers.tick(7500);
  assert.equal(c.isOpen(), true); // contou do zero ao sair
  mock.timers.tick(750);
  assert.equal(c.isOpen(), false);
  c.dispose();
  mock.timers.reset();
});

test('reset: volta a recolhido sem animação e encolhe a janela', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  log.length = 0;
  c.reset();
  assert.deepEqual(log, ['visual:close', 'closeWindow']);
  assert.equal(c.isOpen(), false);
  c.dispose();
  mock.timers.reset();
});

test('falha ao ampliar a janela: volta ao estado fechado', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const log: string[] = [];
  const c = createIslandController({
    openWindow: () => Promise.reject(new Error('falhou')),
    closeWindow: () => log.push('closeWindow'),
    onVisualChange: (o) => log.push(o ? 'open' : 'close'),
    hide: () => log.push('hide'),
  });
  c.expand();
  await flush();
  assert.equal(c.isOpen(), false);
  assert.deepEqual(log, []);
  c.expand(); // pode tentar de novo
  await flush();
  c.dispose();
  mock.timers.reset();
});

test('esconde 3 s depois de recolhida (nunca enquanto aberta)', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  mock.timers.tick(7000); // aberta e parada, mas ainda não recolheu
  assert.ok(!log.includes('hide'));
  mock.timers.tick(1500); // recolhe aos 8 s
  assert.equal(c.isOpen(), false);
  assert.ok(!log.includes('hide'));
  c.transitionEnded();
  mock.timers.tick(2500);
  assert.ok(!log.includes('hide'));
  mock.timers.tick(750); // 3 s depois do recolhimento
  assert.equal(log.filter((l) => l === 'hide').length, 1);
  mock.timers.tick(60_000); // chamado uma única vez
  assert.equal(log.filter((l) => l === 'hide').length, 1);
  c.dispose();
  mock.timers.reset();
});

test('recém-chegada: o período de graça adia o esconder', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const log: string[] = [];
  const c = createIslandController(
    {
      openWindow: () => Promise.resolve(),
      closeWindow: () => {},
      onVisualChange: () => {},
      hide: () => log.push('hide'),
    },
    { hideMs: 3000, tickMs: 250 },
  );
  c.resume(6000);
  mock.timers.tick(5500);
  assert.deepEqual(log, []); // 5,5 s: ainda dentro da graça
  mock.timers.tick(750);
  assert.deepEqual(log, ['hide']);
  c.dispose();
  mock.timers.reset();
});

test('hover e atividade adiam o esconder; reset desativa o ciclo', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const log: string[] = [];
  const c = createIslandController(
    {
      openWindow: () => Promise.resolve(),
      closeWindow: () => {},
      onVisualChange: () => {},
      hide: () => log.push('hide'),
    },
    { hideMs: 3000, tickMs: 250 },
  );
  c.resume(0);
  c.setHover(true);
  mock.timers.tick(20_000);
  assert.deepEqual(log, []); // com o cursor sobre a ilha nunca esconde
  c.setHover(false);
  mock.timers.tick(2500);
  c.activity();
  mock.timers.tick(2500);
  assert.deepEqual(log, []);
  c.reset();
  mock.timers.tick(60_000);
  assert.deepEqual(log, []); // ciclo desativado
  c.dispose();
  mock.timers.reset();
});
// Correção da revisão: rascunho/foco retêm a ilha aberta ---------------------------------
test('rascunho: com o campo focado ou com texto, a ilha NÃO recolhe por inatividade', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  c.setHold(true);
  mock.timers.tick(120_000); // 2 minutos sem tocar em nada
  assert.equal(c.isOpen(), true);
  assert.ok(!log.includes('visual:close'));
  assert.ok(!log.includes('hide'), 'também não esconde enquanto aberta');
  c.dispose();
  mock.timers.reset();
});

test('rascunho: ao soltar a retenção, o prazo recomeça do zero (não recolhe na hora)', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  c.setHold(true);
  mock.timers.tick(60_000);
  c.setHold(false);
  mock.timers.tick(250);
  assert.equal(c.isOpen(), true, 'não recolheu imediatamente');
  mock.timers.tick(7500);
  assert.equal(c.isOpen(), true);
  mock.timers.tick(1000);
  assert.equal(c.isOpen(), false, 'recolheu 8 s depois de soltar');
  c.dispose();
  mock.timers.reset();
});

test('rascunho: recolher manualmente (Esc/clique/blur) continua funcionando com retenção', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, log, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  c.setHold(true);
  log.length = 0;
  c.collapse(); // o que Esc, clique no mascote e perda de foco fazem
  assert.equal(c.isOpen(), false);
  assert.deepEqual(log, ['visual:close']);
  c.dispose();
  mock.timers.reset();
});

test('rascunho: reset (sair do modo ilha) limpa a retenção', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const { c, resolveOpen } = setup();
  c.expand();
  resolveOpen();
  await flush();
  c.setHold(true);
  c.reset();
  c.resume(0);
  c.expand();
  resolveOpen();
  await flush();
  mock.timers.tick(9000);
  assert.equal(c.isOpen(), false, 'a retenção antiga não vaza para a próxima abertura');
  c.dispose();
  mock.timers.reset();
});