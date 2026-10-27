import { coverageConfigDefaults, defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'src',
      globalSetup: './vitest.globalSetup.ts',
      setupFiles: './src/testSetup.ts',
      // Keeps expected-error tests from flooding stderr; tests that assert other levels stub LOG_LEVEL.
      env: { LOG_LEVEL: 'error' },
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
          'src/testLoopbackRequest.ts',
          // Static data app template assets (incl. the vendored, minified Extensions API library).
          'src/templates/**/*',
          ...coverageConfigDefaults.exclude,
        ],
        reporter: ['text', 'cobertura'],
        reportsDirectory: './coverage/unit',
      },
    },
  }),
);
