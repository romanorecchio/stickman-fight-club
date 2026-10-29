import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['packages/server/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'packages/server/dist/index.js',
  sourcemap: true,
  logLevel: 'info',
  external: ['socket.io'],
});
