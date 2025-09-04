import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'e2e',
      testTimeout: 30_000,
      outputFile: 'junit/e2e.xml',
    },
  }),
);
