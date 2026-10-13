import { build } from 'esbuild';

/** Empacota main e preload em CJS (preload sandboxed não pode usar require relativo). */
export async function buildElectron() {
  await build({
    entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
    outdir: 'dist-electron',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: true,
    logLevel: 'info',
  });
}

if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('build-electron.mjs')) {
  await buildElectron();
}
