import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/** Lê os tokens `--t-*` do CSS real (nunca valores copiados), por variante. */
function readTokens(): { panel: Record<string, string>; island: Record<string, string> } {
  const css = fs.readFileSync(new URL('../src/features/tasks/tasks.css', import.meta.url), 'utf8');
  const block = (selector: string): Record<string, string> => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `bloco ${selector} não encontrado`);
    const body = css.slice(start, css.indexOf('}', start));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/(--t-[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase();
    return out;
  };
  const panel = block('.tasks');
  const island = { ...panel, ...block(".tasks[data-variant='island']") };
  return { panel, island };
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
/** Razão de contraste WCAG 2.x. */
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const { panel, island } = readTokens();

for (const [name, t] of [['painel', panel], ['ilha', island]] as const) {
  test(`${name}: todos os tokens existem e são cores sólidas`, () => {
    for (const k of ['--t-bg', '--t-text', '--t-muted', '--t-field-bg', '--t-field-border', '--t-accent', '--t-accent-text', '--t-danger', '--t-focus', '--t-scroll-thumb']) {
      assert.match(t[k] ?? '', /^#[0-9a-f]{6}$/, k);
    }
  });

  test(`${name}: texto normal >= 4,5:1`, () => {
    const checks: [string, string, string][] = [
      ['texto/fundo', t['--t-text'], t['--t-bg']],
      ['texto secundário/fundo', t['--t-muted'], t['--t-bg']],
      ['texto secundário/campo', t['--t-muted'], t['--t-field-bg']],
      ['texto/campo', t['--t-text'], t['--t-field-bg']],
      ['botão Adicionar (texto/fundo do botão)', t['--t-accent-text'], t['--t-accent']],
      ['erro/fundo', t['--t-danger'], t['--t-bg']],
      ['erro/campo', t['--t-danger'], t['--t-field-bg']],
    ];
    for (const [label, fg, bg] of checks) {
      assert.ok(ratio(fg, bg) >= 4.5, `${name} ${label}: ${ratio(fg, bg).toFixed(2)}:1 (< 4,5)`);
    }
  });

  test(`${name}: componentes de interface (bordas, foco, rolagem, botão) >= 3:1`, () => {
    const checks: [string, string, string][] = [
      ['borda do campo/fundo', t['--t-field-border'], t['--t-bg']],
      ['borda do campo/preenchimento', t['--t-field-border'], t['--t-field-bg']],
      ['anel de foco/fundo', t['--t-focus'], t['--t-bg']],
      ['barra de rolagem/fundo', t['--t-scroll-thumb'], t['--t-bg']],
      ['botão/fundo', t['--t-accent'], t['--t-bg']],
      ['ícones (texto secundário)/fundo', t['--t-muted'], t['--t-bg']],
    ];
    for (const [label, fg, bg] of checks) {
      assert.ok(ratio(fg, bg) >= 3, `${name} ${label}: ${ratio(fg, bg).toFixed(2)}:1 (< 3)`);
    }
  });
}

test('painel: o fundo do token é o mesmo do painel real (panel.css)', () => {
  const panelCss = fs.readFileSync(new URL('../src/features/panel/panel.css', import.meta.url), 'utf8');
  const m = panelCss.match(/background:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(m, 'panel.css sem background');
  assert.equal(m[1].toLowerCase(), panel['--t-bg']);
});

test('referência: os valores reais ficam dentro do esperado (guarda contra regressão)', () => {
  assert.ok(ratio(panel['--t-accent-text'], panel['--t-accent']) >= 4.5);
  assert.ok(ratio(panel['--t-field-border'], panel['--t-bg']) >= 3);
  assert.ok(ratio(island['--t-field-border'], island['--t-bg']) >= 3);
});