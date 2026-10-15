import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { qrMatrix } from '../shared/sync/qr.ts';
import { encodePairing } from '../shared/sync/pairing.ts';

/** Desenha a matriz como imagem (módulos pretos em fundo branco, com margem) para o leitor decodificar. */
function toImage(matrix: boolean[][], scale = 6, margin = 4) {
  const size = (matrix.length + margin * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, r) =>
    row.forEach((on, c) => {
      if (!on) return;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + margin) * scale + y) * size + (c + margin) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }),
  );
  return { data, size };
}

test('QR: o texto do pareamento sobrevive ao desenho e à leitura', () => {
  const text = encodePairing({ url: 'https://abcdefghijklmnopqrst.supabase.co', tokenHash: 'e'.repeat(64), now: 1_700_000_000_000 });
  const { data, size } = toImage(qrMatrix(text));
  const read = jsQR(data, size, size);
  assert.equal(read?.data, text);
});
