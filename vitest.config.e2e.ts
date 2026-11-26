import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'tests/e2e',
      // Suites rebuild and spawn servers from the same build/ files. Running files concurrently
      // can start a server while another suite is still writing its bundle.
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  }),
);
