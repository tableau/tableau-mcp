import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'eval',
      testTimeout: 600_000,
      outputFile: 'junit/eval.xml',
    },
  }),
);
