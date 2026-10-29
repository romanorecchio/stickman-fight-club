import { spawn } from 'node:child_process';
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['packages/server/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'packages/server/dist/index.js',
  external: ['socket.io'],
  sourcemap: true,
  logLevel: 'silent',
});

const server = spawn('node', ['packages/server/dist/index.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: process.env.PORT ?? '4318',
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://127.0.0.1:4317,http://localhost:4317',
  },
});
const client = spawn('npm', ['run', 'dev', '-w', '@sfc/client'], { stdio: 'inherit' });

function stop() {
  server.kill('SIGTERM');
  client.kill('SIGTERM');
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => {
  if (code) process.exit(code);
});
