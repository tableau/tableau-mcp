import { BuildOptions } from 'esbuild';

import { Variant } from './variants';

export type GlobalIdentifierName = 'BUILD_VARIANT';

type GlobalIdentifier = {
  name: GlobalIdentifierName;
  defaultValue: string;
  action: (value: string) => BuildOptions | undefined;
};

export const globalIdentifiers: ReadonlyArray<GlobalIdentifier> = [
  {
    name: 'BUILD_VARIANT',
    defaultValue: 'default' satisfies Variant,
    action: (value: string): BuildOptions | undefined => {
      if (value === 'default') {
        return {
          entryPoints: ['./src/index.js'],
          outfile: './build/index.js',
        };
      }

      return {
        entryPoints: [`./src/index.${value}.js`],
        outfile: `./build/index.${value}.js`,
      };
    },
  },
] as const;
