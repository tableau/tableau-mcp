import { coverageConfigDefaults, defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'src',
      setupFiles: './src/testSetup.ts',
      outputFile: 'junit/unit.xml',
      coverage: {
        provider: 'v8',
        include: ['src'],
        exclude: [
          'src/scripts/**/*',
          'src/sdks/**/*',
          'src/server/**/*',
          // Test-only helpers living in src/ (mock servers, fixtures) — never shipped
          // (nothing in the entry graph imports them) and not meaningful to cover.
          '**/*.mock.ts',
          '**/mock*.ts',
          '**/*Fixtures.ts',
          'src/testShared.ts',
          ...coverageConfigDefaults.exclude,
        ],
        reporter: ['text', 'cobertura'],
        reportsDirectory: './coverage/unit',
      },
    },
  }),
);
