import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRectToArea,
  floatingBounds,
  islandBounds,
  pickDisplayForRect,
  resolveIslandDisplay,
  bottomCornerBounds,
  type DisplayInfo,
} from '../shared/geometry.ts';

const primary: DisplayInfo = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 }, // barra de tarefas embaixo (40)
};
const second: DisplayInfo = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 1280, height: 1024 },
  workArea: { x: 1920, y: 0, width: 1280, height: 1024 },
};
const SIZE = 240;

test('floating: sem posição salva, canto inferior direito da área útil', () => {
  const r = floatingBounds(null, SIZE, [primary], 1);
  assert.deepEqual(r, { x: 1920 - SIZE - 40, y: 1040 - SIZE - 20, width: SIZE, height: SIZE });
});

test('floating: respeita posição salva visível', () => {
  const r = floatingBounds({ x: 300, y: 200 }, SIZE, [primary], 1);
  assert.deepEqual(r, { x: 300, y: 200, width: SIZE, height: SIZE });
});

test('floating: respeita posição parcialmente fora da tela (>= 50% visível)', () => {
  const r = floatingBounds({ x: -100, y: 200 }, SIZE, [primary], 1);
  assert.equal(r.x, -100);
});

test('floating: posição quase toda fora da tela volta ao padrão', () => {
  const r = floatingBounds({ x: -220, y: 200 }, SIZE, [primary], 1);
  assert.equal(r.x, 1920 - SIZE - 40);
});

test('floating: posição no segundo monitor é mantida', () => {
  const r = floatingBounds({ x: 2400, y: 100 }, SIZE, [primary, second], 1);
  assert.deepEqual(r, { x: 2400, y: 100, width: SIZE, height: SIZE });
});

test('floating: monitor removido volta ao primário', () => {
  const r = floatingBounds({ x: 2400, y: 100 }, SIZE, [primary], 1);
  assert.equal(r.x, 1920 - SIZE - 40);
});

test('floating: monitor preferido é usado no padrão', () => {
  const r = floatingBounds(null, SIZE, [primary, second], 1, 2);
  assert.equal(r.x, 1920 + 1280 - SIZE - 40);
});

test('clampRectToArea mantém o retângulo dentro e ancora se não couber', () => {
  const area = { x: 0, y: 0, width: 100, height: 100 };
  assert.deepEqual(clampRectToArea({ x: 90, y: -5, width: 20, height: 20 }, area), { x: 80, y: 0, width: 20, height: 20 });
  assert.deepEqual(clampRectToArea({ x: 10, y: 10, width: 300, height: 300 }, area), { x: 0, y: 0, width: 300, height: 300 });
});

test('pickDisplayForRect escolhe pela maior sobreposição e usa fallback', () => {
  const onSecond = { x: 2000, y: 10, width: 240, height: 240 };
  assert.equal(pickDisplayForRect(onSecond, [primary, second]).id, 2);
  const nowhere = { x: 9000, y: 9000, width: 240, height: 240 };
  assert.equal(pickDisplayForRect(nowhere, [primary, second], 2).id, 2);
  assert.equal(pickDisplayForRect(nowhere, [primary, second]).id, 1);
});

test('island: centralizada no topo da área útil', () => {
  const r = islandBounds(primary, { width: 400, height: 80 });
  assert.deepEqual(r, { x: 760, y: 0, width: 400, height: 80 });
});

test('island: respeita barra de tarefas no topo (workArea.y > 0)', () => {
  const topBar: DisplayInfo = { ...primary, workArea: { x: 0, y: 48, width: 1920, height: 1032 } };
  assert.equal(islandBounds(topBar, { width: 400, height: 80 }).y, 48);
});

test('island: monitor secundário com origem deslocada', () => {
  const r = islandBounds(second, { width: 400, height: 80 });
  assert.equal(r.x, 1920 + (1280 - 400) / 2);
});

test('island: nunca excede a área útil', () => {
  const r = islandBounds(second, { width: 5000, height: 5000 });
  assert.equal(r.width, 1280);
  assert.equal(r.height, 1024);
});

test('resolveIslandDisplay: usa o preferido, senão o primário, senão o primeiro', () => {
  assert.equal(resolveIslandDisplay(2, [primary, second], 1).id, 2);
  assert.equal(resolveIslandDisplay(99, [primary, second], 1).id, 1);
  assert.equal(resolveIslandDisplay(null, [second], 1).id, 2);
  assert.equal(resolveIslandDisplay(undefined, [primary, second], 2).id, 2);
});

test('island: tamanho compacto padrão fica centralizado no topo', () => {
  const r = islandBounds(primary, { width: 176, height: 58 });
  assert.deepEqual(r, { x: 872, y: 0, width: 176, height: 58 });
});

test('bottomCornerBounds: cantos inferiores rentes à área útil (barra embaixo)', () => {
  assert.deepEqual(bottomCornerBounds(primary, 240, 'left'), { x: 0, y: 800, width: 240, height: 240 });
  assert.deepEqual(bottomCornerBounds(primary, 240, 'right'), { x: 1680, y: 800, width: 240, height: 240 });
});

test('bottomCornerBounds: segundo monitor com origem deslocada', () => {
  assert.deepEqual(bottomCornerBounds(second, 240, 'right'), { x: 1920 + 1280 - 240, y: 1024 - 240, width: 240, height: 240 });
});