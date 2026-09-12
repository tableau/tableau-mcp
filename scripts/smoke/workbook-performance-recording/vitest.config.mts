import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export default defineConfig({
  root: repositoryRoot,
  test: {
    environment: 'node',
    include: ['scripts/smoke/workbook-performance-recording/smoke-contracts.test.ts'],
  },
});
