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
    for (const k of ['--t-bg', '--t-text', '--t-muted', '--t-field-bg', '--t-field-border', '--t-accent', '--t-accent-text', '--t-danger', '--t-warn', '--t-focus', '--t-scroll-thumb']) {
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
      ['prioridade média (bolinha)/fundo', t['--t-warn'], t['--t-bg']],
      ['prioridade alta (bolinha)/fundo', t['--t-danger'], t['--t-bg']],
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

/** Configurações: tokens `--s-*` de settings.css, no fundo do painel. */
function readSettingsTokens(): Record<string, string> {
  const css = fs.readFileSync(new URL('../src/features/settings/settings.css', import.meta.url), 'utf8');
  const start = css.indexOf('.settings {');
  assert.ok(start >= 0, 'bloco .settings não encontrado');
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--s-[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

test('configurações: texto >= 4,5:1 e componentes >= 3:1 no fundo do painel', () => {
  const s = readSettingsTokens();
  for (const k of ['--s-bg', '--s-text', '--s-muted', '--s-field-bg', '--s-border', '--s-accent', '--s-accent-text', '--s-danger']) {
    assert.match(s[k] ?? '', /^#[0-9a-f]{6}$/, k);
  }
  const text: [string, string, string][] = [
    ['texto/fundo', s['--s-text'], s['--s-bg']],
    ['secundário/fundo', s['--s-muted'], s['--s-bg']],
    ['texto/campo', s['--s-text'], s['--s-field-bg']],
    ['botão marcado (texto/fundo)', s['--s-accent-text'], s['--s-accent']],
    ['aviso (erro/fundo)', s['--s-danger'], s['--s-bg']],
    ['aviso ok (verde/fundo)', s['--s-accent'], s['--s-bg']],
  ];
  for (const [label, fg, bg] of text) assert.ok(ratio(fg, bg) >= 4.5, `${label}: ${ratio(fg, bg).toFixed(2)}:1`);
  const ui: [string, string, string][] = [
    ['borda dos campos/fundo', s['--s-border'], s['--s-bg']],
    ['borda/preenchimento', s['--s-border'], s['--s-field-bg']],
    ['botão marcado/fundo', s['--s-accent'], s['--s-bg']],
  ];
  for (const [label, fg, bg] of ui) assert.ok(ratio(fg, bg) >= 3, `${label}: ${ratio(fg, bg).toFixed(2)}:1`);
});

test('configurações: o fundo é o mesmo do painel real', () => {
  const panelCss = fs.readFileSync(new URL('../src/features/panel/panel.css', import.meta.url), 'utf8');
  const m = panelCss.match(/background:\s*(#[0-9a-fA-F]{6})/);
  assert.equal(m?.[1].toLowerCase(), readSettingsTokens()['--s-bg']);
});

/** Balão e selo da ilha: texto claro sobre o escuro da ilha (e escuro sobre claro no balão solto). */
test('balão de fala: contraste do texto nos dois temas', () => {
  const css = fs.readFileSync(new URL('../src/features/personality/speech.css', import.meta.url), 'utf8');
  const colors = [...css.matchAll(/(?:background|color):\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1].toLowerCase());
  assert.ok(colors.length >= 4, 'cores do balão não encontradas');
  assert.ok(ratio('#f3eef7', '#2b2433') >= 4.5, 'balão da ilha');
  assert.ok(ratio('#3b3040', '#fffaf5') >= 4.5, 'balão solto');
  assert.ok(colors.includes('#2b2433') && colors.includes('#fffaf5'));
});

/** Tema escuro do painel: os mesmos testes de contraste, sobre os tokens escuros reais do CSS. */
function readBlock(file: string, selector: string, prefix: string): Record<string, string> {
  const css = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `bloco ${selector} não encontrado`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(new RegExp(`(${prefix}[\\w-]+):\\s*(#[0-9a-fA-F]{6})\\b`, 'g'))) out[m[1]] = m[2].toLowerCase();
  return out;
}

test('painel escuro (tarefas e foco): texto >= 4,5:1 e componentes >= 3:1', () => {
  const d = readBlock('../src/features/tasks/tasks.css', ".panel[data-theme='dark'] .tasks[data-variant='panel']", '--t-');
  const text: [string, string, string][] = [
    ['texto/fundo', d['--t-text'], d['--t-bg']],
    ['secundário/fundo', d['--t-muted'], d['--t-bg']],
    ['texto/campo', d['--t-text'], d['--t-field-bg']],
    ['secundário/campo', d['--t-muted'], d['--t-field-bg']],
    ['botão (texto/fundo)', d['--t-accent-text'], d['--t-accent']],
    ['erro/fundo', d['--t-danger'], d['--t-bg']],
    ['verde/fundo (prazo de hoje, "ok")', d['--t-accent'], d['--t-bg']],
  ];
  for (const [label, fg, bg] of text) assert.ok(ratio(fg, bg) >= 4.5, `${label}: ${ratio(fg, bg).toFixed(2)}:1`);
  const ui: [string, string, string][] = [
    ['borda/fundo', d['--t-field-border'], d['--t-bg']],
    ['borda/campo', d['--t-field-border'], d['--t-field-bg']],
    ['foco/fundo', d['--t-focus'], d['--t-bg']],
    ['rolagem/fundo', d['--t-scroll-thumb'], d['--t-bg']],
  ];
  for (const [label, fg, bg] of ui) assert.ok(ratio(fg, bg) >= 3, `${label}: ${ratio(fg, bg).toFixed(2)}:1`);
});

test('painel escuro: o fundo do painel é o do token e as configurações usam os mesmos valores', () => {
  const panelCss = fs.readFileSync(new URL('../src/features/panel/panel.css', import.meta.url), 'utf8');
  const m = panelCss.match(/\.panel\[data-theme='dark'\] \{[^}]*background:\s*(#[0-9a-fA-F]{6})/);
  assert.ok(m, 'fundo escuro do painel não encontrado');
  const tasks = readBlock('../src/features/tasks/tasks.css', ".panel[data-theme='dark'] .tasks[data-variant='panel']", '--t-');
  const settings = readBlock('../src/features/settings/settings.css', ".panel[data-theme='dark'] .settings", '--s-');
  assert.equal(m[1].toLowerCase(), tasks['--t-bg']);
  assert.equal(settings['--s-bg'], tasks['--t-bg']);
  const text: [string, string, string][] = [
    ['texto/fundo', settings['--s-text'], settings['--s-bg']],
    ['secundário/fundo', settings['--s-muted'], settings['--s-bg']],
    ['texto/campo', settings['--s-text'], settings['--s-field-bg']],
    ['botão marcado', settings['--s-accent-text'], settings['--s-accent']],
    ['aviso', settings['--s-danger'], settings['--s-bg']],
  ];
  for (const [label, fg, bg] of text) assert.ok(ratio(fg, bg) >= 4.5, `${label}: ${ratio(fg, bg).toFixed(2)}:1`);
  assert.ok(ratio(settings['--s-border'], settings['--s-bg']) >= 3);
  assert.ok(ratio(settings['--s-accent'], settings['--s-bg']) >= 3);
});