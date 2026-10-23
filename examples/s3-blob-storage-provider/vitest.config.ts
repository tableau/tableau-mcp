import { defineConfig } from 'vitest/config';

// Own config so vitest doesn't walk up to tableau-mcp's root config.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
