import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** App Android/web do Nimboo: a mesma base de código do PC, empacotada à parte (Capacitor na parte 3b). */
export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  resolve: { alias: { 'node:crypto': path.resolve(here, 'src/platform/cryptoShim.ts') } },
  server: { port: 5174, strictPort: true, fs: { allow: [path.resolve(here, '..')] } },
  build: { outDir: path.resolve(here, '..', 'dist-mobile'), emptyOutDir: true },
});
