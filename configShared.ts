import { defineConfig } from 'vitest/config.js';

export const configShared = {
  test: {
    globals: true,
    watch: false,
    include: ['**/*.test.ts'],
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
  },
} satisfies Parameters<typeof defineConfig>[0];
