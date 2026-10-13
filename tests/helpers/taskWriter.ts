/**
 * Processo auxiliar dos testes de concorrência: abre o MESMO arquivo SQLite em
 * outro processo e cria tarefas, para provar que várias conexões não se corrompem.
 * Uso: node tests/helpers/taskWriter.ts <arquivo.db> <quantidade> <prefixo>
 */
import { openDatabase } from '../../electron/tasks/database.ts';
import { SqliteTaskRepository } from '../../electron/tasks/sqliteTaskRepository.ts';

const [file, countArg, prefix] = process.argv.slice(2);
const db = openDatabase(file, { busyTimeoutMs: 15_000 });
const repo = new SqliteTaskRepository(db);

for (let i = 0; i < Number(countArg); i++) {
  const result = await repo.create(`${prefix} ${i}`);
  if (!result.ok) {
    console.error('falha ao criar', result.error);
    process.exit(2);
  }
}
db.close();
