import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/glass.css', import.meta.url), 'utf8');
const hex = (name: string): string => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  assert.ok(m, `token --${name} não achado`);
  return (m as RegExpExecArray)[1];
};

const lum = (h: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('vidro escuro: texto, texto apagado e destaque passam no contraste sobre a base escura', () => {
  const base = hex('glass-base');
  assert.ok(ratio(hex('glass-text'), base) >= 7, 'texto');
  assert.ok(ratio(hex('glass-muted'), base) >= 4.5, 'texto apagado');
  assert.ok(ratio(hex('glass-accent'), base) >= 4.5, 'destaque');
  assert.ok(ratio(hex('glass-danger'), base) >= 4.5, 'erro');
  assert.ok(ratio(hex('glass-warn'), base) >= 4.5, 'aviso');
  assert.ok(ratio(hex('glass-accent-text'), hex('glass-accent')) >= 4.5, 'texto sobre o botão de destaque');
});

test('vidro escuro: a camada de janela é translúcida (deixa o acrílico aparecer)', () => {
  const m = /--glass-window:\s*rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\)/.exec(css);
  assert.ok(m);
  const alpha = Number((m as RegExpExecArray)[1]);
  assert.ok(alpha > 0.3 && alpha < 0.8, `alfa ${alpha}`);
});
