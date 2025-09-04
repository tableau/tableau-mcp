import { mergeConfig } from 'vitest/config';

import { configShared } from './vitest.config.base';

export default mergeConfig(configShared, {
  test: {
    dir: 'e2e',
    testTimeout: 30000,
  },
});
