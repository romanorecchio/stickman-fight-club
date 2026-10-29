import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  base: './',
  resolve: {
    alias: {
      '@sfc/shared': path.resolve(dir, '../shared/src/index.ts'),
      '@sfc/sim': path.resolve(dir, '../sim/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 4317,
    strictPort: true,
    fs: { allow: [path.resolve(dir, '../..')] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
