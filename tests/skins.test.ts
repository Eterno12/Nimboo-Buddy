import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../electron/tasks/database.ts';
import { SqliteBondStore } from '../electron/bond/bondStore.ts';
import { BondEngine } from '../electron/bond/bondEngine.ts';
import { SKINS, balanceOf, skinById } from '../shared/skins.ts';
import { CHARACTERS, parseSettings } from '../shared/settings.ts';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mochi-skins-'));
  const db = openDatabase(path.join(dir, 'data', 'mochi.db'));
  const make = () => new BondEngine({ store: new SqliteBondStore(db) });
  return { make, done: () => (db.close(), fs.rmSync(dir, { recursive: true, force: true })) };
}

test('acessórios: cada personagem tem os seus, ids únicos e preços positivos', () => {
  assert.equal(new Set(SKINS.map((s) => s.id)).size, SKINS.length);
  for (const c of CHARACTERS) assert.ok(SKINS.some((s) => s.character === c), c);
  for (const s of SKINS) {
    assert.ok(s.id.startsWith(`${s.character}.`) && s.price > 0, s.id);
  }
  assert.equal(skinById('cactus.escuros')?.character, 'cactus');
  assert.equal(skinById('nao.existe'), null);
});

test('acessórios: comprar gasta o saldo mas não o total de pontos; persiste', () => {
  const t = setup();
  try {
    const engine = t.make();
    assert.equal(engine.buySkin('cactus.bandana'), null, 'sem pontos');
    for (let i = 0; i < 10; i++) engine.handle({ type: 'task_completed' });
    const before = engine.snapshot();
    // Conquistas por horário/dia podem somar pontos extras: o teste usa o total real.
    const total = before.points;
    assert.ok(total >= 35 && total < 70, `pontos ${total}`);
    assert.equal(before.balance, total);

    const bought = engine.buySkin('cactus.bandana');
    assert.equal(bought?.points, total);
    assert.equal(bought?.balance, total - 20);
    assert.deepEqual(bought?.ownedSkins, ['cactus.bandana']);

    assert.equal(engine.buySkin('cactus.bandana'), null, 'não compra duas vezes');
    assert.equal(engine.buySkin('cactus.escuros'), null, 'saldo insuficiente (50)');
    assert.equal(engine.buySkin('xx.yy'), null, 'id desconhecido');
    assert.equal(engine.buySkin(42), null);

    const again = t.make().snapshot();
    assert.equal(again.balance, total - 20);
    assert.deepEqual(again.ownedSkins, ['cactus.bandana']);
  } finally {
    t.done();
  }
});

test('acessórios: saldo nunca fica negativo e ids desconhecidos não contam', () => {
  assert.equal(balanceOf(10, ['cactus.escuros']), 0);
  assert.equal(balanceOf(100, ['cactus.escuros', 'lixo.lixo']), 50);
});

test('acessório em uso: só ids válidos ou null nas preferências', () => {
  const ok = parseSettings({ version: 3, skin: 'ghost.mascara' });
  assert.equal(ok.skin, 'ghost.mascara');
  const bad = parseSettings({ version: 3, skin: '../../x' });
  assert.equal(bad.skin, null);
});
