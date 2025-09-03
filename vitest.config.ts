import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    include: ['**/*.test.ts'],
    setupFiles: './src/testSetup.ts',
    reporters: [
      [
        'default',
        {
          summary: false,
        },
      ],
      'junit',
    ],
    outputFile: 'junit/results.xml',
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
    poolOptions: {
      forks: {
        // disable Node warning about globSync
        execArgv: ['--disable-warning=ExperimentalWarning'],
      },
    },
    onConsoleLog: () => {
      // don't show console.log in tests
      return false;
    },
  },
});
