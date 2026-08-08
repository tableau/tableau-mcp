import { defineConfig } from 'vitest/config.js';

export const configShared = {
  test: {
    globals: true,
    watch: false,
    include: ['**/*.test.ts'],
    // A few asset-heavy suites (listTemplates, bookmarkTemplate, remoteProvider) walk the
    // bundled 15 MB template corpus and legitimately exceed vitest's 5s default on slow or
    // shared machines, so plain `npx vitest run <file>` stays usable without wrapper flags.
    testTimeout: 30_000,
    // Bounds afterAll/teardown hooks under load. NOTE: this does NOT govern the
    // `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error occasionally seen
    // on saturated machines after every test passes — that is the worker→main birpc
    // watchdog, which vitest 3.x exposes no config for. Reducing main-process load
    // (fewer reporters, fewer workers) is the only real lever.
    teardownTimeout: 30_000,
    // No workflow parses junit/unit.xml. Keep passing-test logs off the CI worker channel;
    // failures still print their captured output for diagnosis.
    silent: process.env.CI ? 'passed-only' : false,
    reporters: [['default', { summary: false }]],
  },
} satisfies Parameters<typeof defineConfig>[0];
