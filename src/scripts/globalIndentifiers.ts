import { BuildOptions } from 'esbuild';

import { BuildMode } from './buildModes';

export type GlobalIdentifierName = 'BUILD_MODE';

type GlobalIdentifier = {
  name: GlobalIdentifierName;
  defaultValue: string;
  action: (value: string) => BuildOptions | undefined;
};

export const globalIdentifiers: ReadonlyArray<GlobalIdentifier> = [
  {
    name: 'BUILD_MODE',
    defaultValue: 'default' satisfies BuildMode,
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
] as const;
