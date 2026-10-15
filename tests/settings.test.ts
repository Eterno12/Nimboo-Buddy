import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, parseSettings } from '../shared/settings.ts';
import { resolveTheme } from '../src/features/settings/useTheme.ts';
import { createSettingsStore } from '../electron/settingsStore.ts';

test('parseSettings: nome do personagem é aparado e limitado', () => {
  assert.equal(parseSettings({ version: 3, mascotName: '  Bolinho   Doce ' }).mascotName, 'Bolinho Doce');
  for (const bad of ['', '   ', 'x'.repeat(21), '<b>oi</b>', 'a\u0007b', 42, null]) {
    assert.equal(parseSettings({ version: 3, mascotName: bad }).mascotName, DEFAULT_SETTINGS.mascotName, String(bad));
  }
});

test('parseSettings: entradas inválidas viram padrão', () => {
  for (const bad of [null, undefined, 42, 'x', [], {}, { version: 2 }]) {
    assert.deepEqual(parseSettings(bad), DEFAULT_SETTINGS);
  }
});

test('parseSettings: aceita valores válidos e arredonda posição', () => {
  const s = parseSettings({ version: 2, mode: 'floating', floating: { x: 10.6, y: 20 }, displayId: 3 });
  assert.deepEqual(s, { ...DEFAULT_SETTINGS, mode: 'floating', floating: { x: 11, y: 20 }, displayId: 3 });
});

test('parseSettings: campos inválidos caem no padrão e extras são descartados', () => {
  const s = parseSettings({
    version: 2,
    mode: 'banana',
    floating: { x: 'a', y: NaN },
    displayId: Infinity,
    extra: 'x',
  });
  assert.deepEqual(s, DEFAULT_SETTINGS);
  assert.ok(!('extra' in s));
});

function tempFile(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-settings-'));
  return { dir, file: path.join(dir, 'settings.json') };
}

test('store: arquivo ausente usa padrões e grava ao dar flush', () => {
  const { dir, file } = tempFile();
  const store = createSettingsStore(file, 10_000);
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  store.update({ mode: 'island', floating: { x: 5, y: 6 } });
  store.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {
    ...DEFAULT_SETTINGS,
    floating: { x: 5, y: 6 },
  });
  assert.ok(!fs.existsSync(`${file}.tmp`));
  // Reabrir lê o que foi salvo.
  assert.equal(createSettingsStore(file).get().mode, 'island');
  fs.rmSync(dir, { recursive: true });
});

test('store: arquivo corrompido vira .bak e segue com padrões', () => {
  const { dir, file } = tempFile();
  fs.writeFileSync(file, '{ não é json');
  const store = createSettingsStore(file);
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.ok(fs.existsSync(`${file}.bak`));
  fs.rmSync(dir, { recursive: true });
});

test('store: get devolve cópia (mutação externa não vaza)', () => {
  const { dir, file } = tempFile();
  const store = createSettingsStore(file);
  store.update({ floating: { x: 1, y: 2 } });
  const copy = store.get();
  copy.floating!.x = 999;
  assert.equal(store.get().floating!.x, 1);
  store.flush();
  fs.rmSync(dir, { recursive: true });
});

test('parseSettings: versão 1 migra para o padrão atual (ilha) e mantém a posição', () => {
  const s = parseSettings({ version: 1, mode: 'floating', floating: { x: 5, y: 6 }, displayId: 2 });
  assert.deepEqual(s, { ...DEFAULT_SETTINGS, floating: { x: 5, y: 6 }, displayId: 2 });
});

test('padrão é a ilha', () => {
  assert.equal(DEFAULT_SETTINGS.mode, 'island');
});

test('store: a escolha "flutuante" é gravada e relida (não é descartada pela migração)', () => {
  const { dir, file } = tempFile();
  const store = createSettingsStore(file, 10_000);
  store.update({ mode: 'floating' });
  store.flush();
  assert.equal(store.get().mode, 'floating');
  assert.equal(createSettingsStore(file).get().mode, 'floating');
  fs.rmSync(dir, { recursive: true });
});

test('store: arquivo v1 antigo é lido e migrado', () => {
  const { dir, file } = tempFile();
  fs.writeFileSync(file, JSON.stringify({ version: 1, mode: 'floating', floating: { x: 9, y: 9 }, displayId: null }));
  const s = createSettingsStore(file).get();
  assert.equal(s.mode, 'island');
  assert.deepEqual(s.floating, { x: 9, y: 9 });
  fs.rmSync(dir, { recursive: true });
});

test('v2 (sem os campos novos) migra para v3 com os padrões e mantém o que existia', () => {
  const s = parseSettings({ version: 2, mode: 'floating', floating: { x: 1, y: 2 }, displayId: 7 });
  assert.equal(s.version, 3);
  assert.equal(s.mode, 'floating');
  assert.deepEqual(s.floating, { x: 1, y: 2 });
  assert.equal(s.displayId, 7);
  assert.equal(s.islandScale, 1);
  assert.equal(s.mochiScale, 1);
  assert.equal(s.launchAtLogin, false, 'iniciar com o Windows nunca liga sozinho');
  assert.equal(s.shortcut, DEFAULT_SETTINGS.shortcut);
});

test('v3: tamanhos viram o passo permitido mais próximo; lixo volta ao padrão', () => {
  const near = parseSettings({ version: 3, islandScale: 1.07, mochiScale: 5, hideDelaySec: 9 });
  assert.equal(near.islandScale, 1.1);
  assert.equal(near.mochiScale, 1.6);
  assert.equal(near.hideDelaySec, 10);
  const junk = parseSettings({
    version: 3,
    islandScale: 'grande',
    mochiScale: NaN,
    launchAtLogin: 'sim',
    shortcut: 'Control+Q',
    soundEnabled: 1,
    bubbles: null,
    color: 'neon',
    soundVolume: 'alto',
  });
  assert.deepEqual(junk, DEFAULT_SETTINGS);
});

test('v3: atalho só aceita os predefinidos ou null (desligado); volume é limitado a 0..1', () => {
  assert.equal(parseSettings({ version: 3, shortcut: null }).shortcut, null);
  assert.equal(parseSettings({ version: 3, shortcut: 'Control+Alt+J' }).shortcut, 'Control+Alt+J');
  assert.equal(parseSettings({ version: 3, shortcut: 'Control+Alt+Delete' }).shortcut, DEFAULT_SETTINGS.shortcut);
  assert.equal(parseSettings({ version: 3, soundVolume: 7 }).soundVolume, 1);
  assert.equal(parseSettings({ version: 3, soundVolume: -2 }).soundVolume, 0);
});

test('store: update parcial mantém o resto e persiste os novos campos', () => {
  const { dir, file } = tempFile();
  const store = createSettingsStore(file, 10_000);
  store.update({ islandScale: 1.25, color: 'peach', soundEnabled: false });
  store.update({ mochiScale: 0.7 });
  store.flush();
  const reopened = createSettingsStore(file).get();
  assert.equal(reopened.islandScale, 1.25);
  assert.equal(reopened.mochiScale, 0.7);
  assert.equal(reopened.color, 'peach');
  assert.equal(reopened.soundEnabled, false);
  assert.equal(reopened.mode, 'island');
  fs.rmSync(dir, { recursive: true });
});

test('foco e lembretes: padrões, inteiros dentro do limite e antecedência em passos', () => {
  const d = parseSettings({ version: 3 });
  assert.equal(d.focusMinutes, 25);
  assert.equal(d.breakMinutes, 5);
  assert.equal(d.longBreakMinutes, 15);
  assert.equal(d.pomodoroCycle, false);
  assert.equal(d.pomodoroAuto, false);
  assert.equal(d.remindersEnabled, true);
  assert.equal(d.reminderLeadMin, 10);
  const ok = parseSettings({ version: 3, focusMinutes: 37, breakMinutes: 12, longBreakMinutes: 20, reminderLeadMin: 14 });
  assert.equal(ok.focusMinutes, 37);
  assert.equal(ok.breakMinutes, 12);
  assert.equal(ok.longBreakMinutes, 20);
  assert.equal(ok.reminderLeadMin, 15);
  const bad = parseSettings({ version: 3, focusMinutes: 0, breakMinutes: 61, longBreakMinutes: 1.5, pomodoroCycle: 'sim' });
  assert.equal(bad.focusMinutes, 25);
  assert.equal(bad.breakMinutes, 5);
  assert.equal(bad.longBreakMinutes, 15);
  assert.equal(bad.pomodoroCycle, false);
  assert.equal(parseSettings({ version: 3, focusMinutes: 181 }).focusMinutes, 25);
  assert.equal(parseSettings({ version: 3, focusMinutes: 180 }).focusMinutes, 180);
});

test('tema: padrão automático; só auto/claro/escuro são aceitos; auto segue o sistema', () => {
  assert.equal(DEFAULT_SETTINGS.theme, 'auto');
  assert.equal(parseSettings({ version: 3, theme: 'dark' }).theme, 'dark');
  assert.equal(parseSettings({ version: 3, theme: 'light' }).theme, 'light');
  assert.equal(parseSettings({ version: 3, theme: 'neon' }).theme, 'auto');
  assert.equal(parseSettings({ version: 2, theme: 'dark' }).theme, 'auto', 'v2 não tinha tema');
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
});
test('introdução guiada: arquivo antigo (sem o campo) conta como vista; instalação nova não', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-onb-'));
  try {
    const file = path.join(dir, 'settings.json');
    assert.equal(createSettingsStore(file).get().onboardingDone, false, 'sem arquivo');
    fs.writeFileSync(file, JSON.stringify({ version: 3, character: 'cactus' }));
    assert.equal(createSettingsStore(file).get().onboardingDone, true, 'arquivo antigo');
    fs.writeFileSync(file, JSON.stringify({ version: 3, onboardingDone: false }));
    assert.equal(createSettingsStore(file).get().onboardingDone, false, 'campo explícito vale');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseSettings: hideWhenAway é booleano e desligado por padrão', () => {
  assert.equal(DEFAULT_SETTINGS.hideWhenAway, false);
  assert.equal(parseSettings({ version: 3, hideWhenAway: true }).hideWhenAway, true);
  for (const bad of ['sim', 1, null]) assert.equal(parseSettings({ version: 3, hideWhenAway: bad }).hideWhenAway, false);
});
