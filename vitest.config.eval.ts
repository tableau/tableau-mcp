import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'tests/eval',
      testTimeout: 60 * 1000,
      fileParallelism: false,
      outputFile: 'junit/eval.xml',
    },
  }),
);
