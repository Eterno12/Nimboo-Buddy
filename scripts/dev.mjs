import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { buildElectron } from './build-electron.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

await buildElectron();

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
