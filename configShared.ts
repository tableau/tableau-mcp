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
  },
} satisfies Parameters<typeof defineConfig>[0];
