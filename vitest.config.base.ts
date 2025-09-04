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
};
