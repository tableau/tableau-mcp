import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'tests/oauth',
      setupFiles: './tests/oauth/testSetup.ts',
      fileParallelism: false,
      outputFile: 'junit/oauth.xml',
    },
  }),
);
