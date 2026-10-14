import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRectToArea,
  floatingBounds,
  islandBounds,
  pickDisplayForRect,
  resolveIslandDisplay,
  bottomCornerBounds,
  edgeHintBounds,
  fitScale,
  scaleRect,
  scaleSize,
  type DisplayInfo,
} from '../shared/geometry.ts';
import { islandShapes, ISLAND_BUBBLE_RECT, ISLAND_WINDOW_SIZE } from '../shared/presentation.ts';

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
test('edgeHintBounds: centralizada no topo FÍSICO do monitor, não na área útil', () => {
  const topBar: DisplayInfo = { ...primary, workArea: { x: 0, y: 48, width: 1920, height: 1032 } };
  assert.deepEqual(edgeHintBounds(primary, { width: 280, height: 8 }), { x: 820, y: 0, width: 280, height: 8 });
  assert.equal(edgeHintBounds(topBar, { width: 280, height: 8 }).y, 0, 'ignora a barra de tarefas no topo');
});

test('edgeHintBounds: segundo monitor com origem deslocada e largura limitada ao monitor', () => {
  const r = edgeHintBounds(second, { width: 280, height: 8 });
  assert.equal(r.x, 1920 + (1280 - 280) / 2);
  assert.equal(edgeHintBounds(second, { width: 5000, height: 8 }).width, 1280);
});
test('scaleRect/scaleSize: arredondam para inteiros', () => {
  assert.deepEqual(scaleRect({ x: 88, y: 0, width: 176, height: 58 }, 1.25), { x: 110, y: 0, width: 220, height: 73 });
  assert.deepEqual(scaleSize({ width: 352, height: 380 }, 0.9), { width: 317, height: 342 });
});

test('fitScale: limita ao que cabe no monitor e nunca passa de 50% para baixo', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.equal(fitScale(1.4, ISLAND_WINDOW_SIZE, area), 1.4);
  const small = { x: 0, y: 0, width: 800, height: 450 }; // 440 * s <= 450 → 1.02
  assert.equal(fitScale(1.4, ISLAND_WINDOW_SIZE, small), 1.02);
  assert.equal(fitScale(1, ISLAND_WINDOW_SIZE, { x: 0, y: 0, width: 100, height: 100 }), 0.5);
});

test('islandShapes: sem balão é só a ilha; com balão a área dele entra (apenas recolhida)', () => {
  assert.equal(islandShapes(false, 'home', 1, false).length, 1);
  const withBubble = islandShapes(false, 'home', 1, true);
  assert.equal(withBubble.length, 2);
  assert.deepEqual(withBubble[1], ISLAND_BUBBLE_RECT);
  assert.equal(islandShapes(true, 'tasks', 1, true).length, 1, 'aberta: o balão some');
});

test('islandShapes: ampliadas, nenhuma forma excede a janela ampliada', () => {
  for (const scale of [0.8, 0.9, 1, 1.1, 1.25, 1.4]) {
    const w = Math.round(ISLAND_WINDOW_SIZE.width * scale);
    const h = Math.round(ISLAND_WINDOW_SIZE.height * scale);
    for (const open of [false, true]) {
      for (const extent of ['home', 'home-mini', 'home-player', 'tasks', 'focus'] as const) {
        for (const r of islandShapes(open, extent, scale, true)) {
          assert.ok(r.x >= 0 && r.y >= 0 && r.width >= 1 && r.height >= 1);
          assert.ok(r.x + r.width <= w, `largura ${scale}/${open}/${extent}`);
          assert.ok(r.y + r.height <= h, `altura ${scale}/${open}/${extent}`);
        }
      }
    }
  }
});

test('ilha ampliada continua centralizada no topo e dentro da área útil', () => {
  const size = scaleSize(ISLAND_WINDOW_SIZE, 1.4);
  const r = islandBounds(primary, size);
  assert.equal(r.x, Math.round((1920 - size.width) / 2));
  assert.equal(r.y, 0);
  assert.ok(r.x >= 0 && r.x + r.width <= 1920);
});

test('geometria com monitor à esquerda do primário (coordenadas negativas) e barra à esquerda', () => {
  const left: DisplayInfo = {
    id: 3,
    bounds: { x: -1280, y: 0, width: 1280, height: 1024 },
    workArea: { x: -1280 + 48, y: 0, width: 1280 - 48, height: 1024 }, // barra de 48 px à esquerda
  };
  const r = islandBounds(left, { width: 352, height: 380 });
  assert.equal(r.x, Math.round(-1232 + (1232 - 352) / 2));
  assert.deepEqual(bottomCornerBounds(left, 240, 'left'), { x: -1232, y: 784, width: 240, height: 240 });
  assert.equal(edgeHintBounds(left, { width: 280, height: 8 }).x, -1280 + (1280 - 280) / 2);
  const placed = floatingBounds({ x: -900, y: 100 }, 240, [primary, left], 1);
  assert.equal(placed.x, -900, 'posição salva no monitor da esquerda é respeitada');
});

test('monitor 4K a 150% (workArea em DIP): a ilha usa os mesmos DIP, sem depender de pixels', () => {
  const uhd: DisplayInfo = {
    id: 4,
    bounds: { x: 0, y: 0, width: 2560, height: 1440 }, // 3840x2160 / 1.5
    workArea: { x: 0, y: 0, width: 2560, height: 1392 },
  };
  assert.deepEqual(islandBounds(uhd, { width: 352, height: 380 }), { x: 1104, y: 0, width: 352, height: 380 });
  assert.equal(fitScale(1.4, ISLAND_WINDOW_SIZE, uhd.workArea), 1.4);
});