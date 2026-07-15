import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'tests/e2e',
      testTimeout: 30_000,
      hookTimeout: 30_000,
      outputFile: 'junit/e2e.xml',
      // seaAssets rebuilds ./build in-place (buildVariant) while the other e2e
      // suites are concurrently spawning `node build/index.js` children — the
      // mid-write window kills those children pre-handshake ("Connection
      // closed" in beforeAll). It runs alone via vitest.config.e2e.sea.ts.
      exclude: ['**/node_modules/**', '**/seaAssets.test.ts'],
    },
  }),
);
