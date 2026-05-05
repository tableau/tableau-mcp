import { defineConfig, mergeConfig } from 'vitest/config';

import { configShared } from './configShared';

export default mergeConfig(
  defineConfig(configShared),
  defineConfig({
    test: {
      dir: 'src/desktop',
      outputFile: 'junit/unit.desktop.xml',
      coverage: {
        provider: 'v8',
        include: ['src/desktop'],
        reporter: ['text', 'cobertura'],
        reportsDirectory: './coverage/unit',
      },
    },
  }),
);
