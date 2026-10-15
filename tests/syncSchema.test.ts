import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SYNC_TABLES } from '../electron/sync/syncStore.ts';

/** Lista de tabelas que o servidor aceita: a do ÚLTIMO `check (tbl in (...))` entre as migrações, em ordem. */
function serverTables(): string[] {
  const dir = path.join(import.meta.dirname, '..', 'supabase', 'migrations');
  let latest: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of sql.matchAll(/check\s*\(\s*tbl\s+in\s*\(([^)]*)\)\s*\)/gi)) {
      latest = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
  }
  return latest;
}

test('servidor: toda tabela que o app sincroniza é aceita pela restrição do banco (senão o envio inteiro dá erro 400)', () => {
  const accepted = new Set(serverTables());
  const missing = SYNC_TABLES.filter((t) => !accepted.has(t));
  assert.deepEqual(missing, [], `faltam na migração: ${missing.join(', ')}`);
});
