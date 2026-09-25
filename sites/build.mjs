import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist/server', { recursive: true });
await cp('public', 'dist/client', { recursive: true, force: true });
await build({
  entryPoints: ['sites/worker.mjs'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['node:*'],
});
await writeFile('dist/server/wrangler.json', JSON.stringify({
  name: 'molip-task-dashboard-preview',
  main: 'index.js',
  compatibility_date: '2026-06-01',
  compatibility_flags: ['nodejs_compat', 'nodejs_compat_populate_process_env'],
  assets: { directory: '../client', binding: 'ASSETS', run_worker_first: true },
}, null, 2));
