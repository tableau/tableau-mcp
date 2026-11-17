import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: { dir: 'tests/oauth/server-eas', fileParallelism: false, hookTimeout: 30_000 },
  }),
);
