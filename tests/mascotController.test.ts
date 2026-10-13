import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// O controlador usa `window.setTimeout` etc.; em Node, `window` é o próprio global (com timers falsos).
(globalThis as unknown as { window: unknown }).window = globalThis;

const { createMascotController } = await import('../src/features/mascot/mascotController.ts');
const S = await import('../src/features/mascot/mascotStates.ts');
type Snapshot = import('../src/features/mascot/mascotController.ts').MascotSnapshot;
type Controller = import('../src/features/mascot/mascotController.ts').MascotController;

let snap: Snapshot;
let seen: Snapshot[];
let c: Controller;

beforeEach(() => {
  // Sorteio fixo: os comportamentos espontâneos viram só um pulinho (determinístico).
  mock.method(Math, 'random', () => 0.1);
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
  seen = [];
  snap = { state: 'idle', replay: 0, hop: false, blinking: false, mood: 'mid' };
  c = createMascotController((s) => {
    snap = s;
    seen.push(s);
  });
  c.start();
});

afterEach(() => {
  c.dispose();
  mock.timers.reset();
  mock.restoreAll();
});

const tick = (ms: number) => mock.timers.tick(ms);
/** Cursor perto e rápido, aproximando-se. */
const startleCursor = { distance: 100, speed: S.STARTLE_SPEED_PX_S + 500, approaching: true };

test('começa em idle; carinho vira happy e volta ao repouso sozinho', () => {
  assert.equal(snap.state, 'idle');
  c.pet();
  assert.equal(snap.state, 'happy');
  tick(S.STATE_DURATION_MS.happy! + 10);
  assert.equal(snap.state, 'idle');
});

test('cliques rápidos: 3 viram risadinha; 7 viram emburrado (e continuar clicando prolonga)', () => {
  for (let i = 0; i < S.GIGGLE_CLICKS; i++) {
    c.pet();
    tick(100);
  }
  assert.equal(snap.state, 'giggle');
  tick(S.STATE_DURATION_MS.giggle! + 10);
  assert.equal(snap.state, 'idle');

  for (let i = 0; i < S.ANNOYED_CLICKS; i++) {
    c.pet();
    tick(50);
  }
  assert.equal(snap.state, 'annoyed');
  const replay = snap.replay;
  c.pet(); // insistir: reinicia o mau humor em vez de voltar a ficar feliz
  assert.equal(snap.state, 'annoyed');
  assert.ok(snap.replay > replay);
});

test('celebrar (tarefa concluída) não é interrompido por um carinho simples', () => {
  c.celebrate();
  assert.equal(snap.state, 'celebrate');
  c.pet(); // happy tem prioridade menor
  assert.equal(snap.state, 'celebrate');
  tick(S.STATE_DURATION_MS.celebrate! + 10);
  assert.equal(snap.state, 'idle');
});

test('sem interação, boceja e dorme; qualquer atividade o acorda (espreguiça)', () => {
  tick(S.SLEEP_AFTER_MS + 5);
  assert.equal(snap.state, 'yawn');
  tick(S.STATE_DURATION_MS.yawn! + 10);
  assert.equal(snap.state, 'sleepy');
  c.activity();
  assert.equal(snap.state, 'stretch');
  tick(S.STATE_DURATION_MS.stretch! + 10);
  assert.equal(snap.state, 'idle');
});

test('passar o mouse sobre o corpo desperta curiosidade; sair volta ao repouso', () => {
  c.hoverChange(true);
  assert.equal(snap.state, 'curious');
  c.hoverChange(false);
  assert.equal(snap.state, 'idle');
});

test('cursor rápido e próximo assusta; há intervalo entre sustos', () => {
  c.cursor(startleCursor);
  assert.equal(snap.state, 'surprised');
  tick(S.STATE_DURATION_MS.surprised! + 10);
  assert.equal(snap.state, 'curious', 'o cursor segue perto: volta curioso');
  c.cursor({ ...startleCursor }); // ainda no intervalo
  assert.notEqual(snap.state, 'surprised');
  tick(S.STARTLE_COOLDOWN_MS + 10);
  c.cursor({ ...startleCursor });
  assert.equal(snap.state, 'surprised');
});

test('cursor lento ou longe não assusta', () => {
  c.cursor({ distance: 100, speed: 300, approaching: true });
  assert.notEqual(snap.state, 'surprised');
  c.cursor({ distance: S.STARTLE_DISTANCE_PX + 100, speed: S.STARTLE_SPEED_PX_S + 500, approaching: true });
  assert.notEqual(snap.state, 'surprised');
  c.cursor({ distance: 100, speed: S.STARTLE_SPEED_PX_S + 500, approaching: false });
  assert.notEqual(snap.state, 'surprised');
});

test('arrastar: grabbed tem prioridade máxima; soltar volta ao repouso com um pulinho', () => {
  c.celebrate();
  c.grab();
  assert.equal(snap.state, 'grabbed');
  c.pet();
  assert.equal(snap.state, 'grabbed');
  c.release();
  assert.equal(snap.state, 'idle');
  assert.equal(snap.hop, true);
  c.endHop();
  assert.equal(snap.hop, false);
});

test('humor: carinho sobe, o tempo desce; baixo/médio/alto nos limites certos', () => {
  assert.equal(snap.mood, 'mid');
  // 0,5 + 2 × 0,12 = 0,74 > 0,65 → alto (cliques espaçados, sem risadinha/emburrado)
  c.pet();
  tick(S.GIGGLE_WINDOW_MS + 10);
  c.pet();
  assert.equal(snap.mood, 'high');
  // 30 s por passo de 0,03: de 0,74 até < 0,25 leva ~17 passos
  tick(S.AFFECTION_DECAY_MS * 17 + 100);
  assert.equal(snap.mood, 'low');
});

test('piscar: acontece em idle e termina rápido', () => {
  tick(S.BLINK_MAX_MS + 10);
  assert.ok(seen.some((s) => s.blinking), 'piscou ao menos uma vez');
  tick(S.BLINK_DURATION_MS + 10);
  assert.equal(snap.blinking, false);
});

test('dispose: nenhum timer dispara depois', () => {
  c.dispose();
  const before = seen.length;
  tick(10 * 60_000);
  assert.equal(seen.length, before);
});

test('comportamentos espontâneos NÃO impedem o sono (o contador só reinicia com atividade)', () => {
  // Sorteio que escolhe "olhar em volta" sempre (r em 0,35..0,65).
  (Math.random as unknown as { mock: { mockImplementation(fn: () => number): void } }).mock.mockImplementation(() => 0.5);
  // Em passos de 1 s: timers criados dentro de callbacks só são executados em ticks seguintes.
  for (let i = 0; i < 60; i++) tick(1000);
  assert.ok(
    seen.some((s) => s.state === 'sleepy'),
    'chegou a dormir mesmo com olhares espontâneos a cada ~12 s',
  );
  assert.ok(seen.some((s) => s.state === 'lookaround'), 'e olhou em volta antes');
});

test('segurar tem prioridade máxima (nem a comemoração o interrompe) e soltar volta ao repouso com um pulinho', () => {
  c.celebrate();
  c.grab();
  assert.equal(snap.state, 'grabbed');
  c.pet(); // happy tem prioridade menor
  assert.equal(snap.state, 'grabbed');
  c.release();
  assert.equal(snap.state, 'idle');
  assert.equal(snap.hop, true);
});