import { coverageConfigDefaults, mergeConfig } from 'vitest/config';

import { configShared } from './vitest.config.base';

export default mergeConfig(configShared, {
  test: {
    dir: 'src',
    setupFiles: './src/testSetup.ts',
    coverage: {
      provider: 'v8',
      include: ['src'],
      exclude: [
        'src/scripts/**/*',
        'src/sdks/**/*',
        'src/server/**/*',
        ...coverageConfigDefaults.exclude,
      ],
      reporter: ['text', 'cobertura'],
      reportsDirectory: './coverage/unit',
    },
  },
});
