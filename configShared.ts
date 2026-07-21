import { defineConfig } from 'vitest/config.js';

export const configShared = {
  test: {
    globals: true,
    watch: false,
    include: ['**/*.test.ts'],
    // CI ran ~157s of parallel tests and the pool→reporter RPC starved, throwing
    // `[vitest-worker]: Timeout calling "onTaskUpdate"` as an *unhandled error* AFTER
    // all 317 files passed — a flaky red on green code (seen on #564; #565 same suite
    // passed clean). Widen the teardown/RPC window so the final task-update exchange
    // completes under load instead of timing out.
    teardownTimeout: 30_000,
    reporters: [
      [
        'default',
        {
          summary: false,
        },
      ],
      'junit',
    ],
  },
} satisfies Parameters<typeof defineConfig>[0];
