import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, parseSettings } from '../shared/settings.ts';
import { createSettingsStore } from '../electron/settingsStore.ts';

test('parseSettings: entradas inválidas viram padrão', () => {
  for (const bad of [null, undefined, 42, 'x', [], {}, { version: 2 }]) {
    assert.deepEqual(parseSettings(bad), DEFAULT_SETTINGS);
  }
});

test('parseSettings: aceita valores válidos e arredonda posição', () => {
  const s = parseSettings({ version: 2, mode: 'floating', floating: { x: 10.6, y: 20 }, displayId: 3 });
  assert.deepEqual(s, { version: 2, mode: 'floating', floating: { x: 11, y: 20 }, displayId: 3 });
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
    version: 2,
    mode: 'island',
    floating: { x: 5, y: 6 },
    displayId: null,
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
  assert.deepEqual(s, { version: 2, mode: 'island', floating: { x: 5, y: 6 }, displayId: 2 });
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