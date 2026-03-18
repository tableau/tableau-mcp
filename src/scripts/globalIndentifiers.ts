import { BuildOptions } from 'esbuild';

import { BuildConfiguration } from './build';

type GlobalIdentifier = {
  name: string;
  defaultValue: string;
  action: (value: string) => BuildOptions | undefined;
};

export const globalIdentifiers: ReadonlyArray<GlobalIdentifier> = [
  {
    name: 'BUILD_CONFIGURATION',
    defaultValue: 'default' satisfies BuildConfiguration,
    action: (value: string): BuildOptions | undefined => {
      if (value === 'default') {
        return {
          outfile: './build/index.js',
        };
      }

      return {
        outfile: `./build/index-${value}.js`,
      };
    },
  },
];
