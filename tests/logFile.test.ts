import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogFile, describe } from '../electron/logFile.ts';

test('registro: grava linhas com data e nível, e faz rodízio ao passar do limite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-log-'));
  try {
    const log = createLogFile(path.join(dir, 'logs'), () => new Date('2026-10-14T12:00:00Z'), 200);
    log.write('error', 'primeiro');
    assert.match(fs.readFileSync(log.file, 'utf8'), /^2026-10-14T12:00:00.000Z ERROR primeiro\n$/);
    for (let i = 0; i < 10; i++) log.write('warn', `linha ${i} ${'x'.repeat(40)}`);
    assert.ok(fs.existsSync(`${log.file}.1`), 'rodízio');
    assert.ok(fs.statSync(log.file).size < 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registro: nunca lança, mesmo sem poder gravar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-log-'));
  try {
    const blocker = path.join(dir, 'arquivo');
    fs.writeFileSync(blocker, 'x');
    assert.doesNotThrow(() => createLogFile(path.join(blocker, 'logs')).write('error', 'x'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registro: describe aceita erros, textos e valores circulares', () => {
  assert.match(describe(new Error('falhou')), /falhou/);
  assert.equal(describe('texto'), 'texto');
  const a: Record<string, unknown> = {};
  a.self = a;
  assert.equal(typeof describe(a), 'string');
});
