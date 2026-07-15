import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

// seaAssets runs OUTSIDE the main e2e pool (see vitest.config.e2e.ts): it
// rebuilds ./build in-place, which must never overlap with suites that spawn
// `node build/index.js` children.
const merged = mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'tests/e2e',
      testTimeout: 180_000,
      hookTimeout: 180_000,
      outputFile: 'junit/e2e-sea.xml',
    },
  }),
);

// Hard override: mergeConfig CONCATENATES include arrays, which would pull the
// whole e2e pool back in.
merged.test!.include = ['**/seaAssets.test.ts'];

export default merged;
