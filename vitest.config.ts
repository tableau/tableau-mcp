import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    include: ['src/**/*.test.ts'],
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
      exclude: ['src/sdks/**/*', ...coverageConfigDefaults.exclude],
      reporter: ['text', 'cobertura'],
      reportsDirectory: './coverage/unit',
    },
  },
});
