import { coverageConfigDefaults, defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
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
  }),
);
