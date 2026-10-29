import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/sim/src/**/*.test.ts', 'packages/server/src/**/*.test.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@sfc/shared': path.resolve(root, 'packages/shared/src/index.ts'),
      '@sfc/sim': path.resolve(root, 'packages/sim/src/index.ts'),
    },
  },
});
