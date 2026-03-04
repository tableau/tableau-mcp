import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'tests/oauth/embedded-authz',
      setupFiles: './tests/oauth/embedded-authz/testSetup.ts',
      fileParallelism: false,
      outputFile: 'junit/oauth-embedded.xml',
    },
  }),
);
