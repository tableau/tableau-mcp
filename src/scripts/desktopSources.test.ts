import { build } from 'esbuild';

import { findDesktopSources } from './desktopSources.js';

describe('findDesktopSources', () => {
  it.each(['src/index.ts', 'src/telemetry/tracing.ts'])(
    'finds no Desktop source in the %s bundle',
    async (entryPoint) => {
      const { metafile } = await build({
        entryPoints: [`./${entryPoint}`],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        packages: 'external',
        write: false,
        metafile: true,
        logLevel: 'silent',
        logOverride: { 'empty-import-meta': 'silent' },
      });
      const inputs = Object.keys(metafile.inputs);

      // Pins the cwd-relative key shape the matcher relies on; absolute keys would pass vacuously.
      expect(inputs).toContain(entryPoint);
      expect(findDesktopSources(inputs)).toEqual([]);
    },
  );

  it('ignores paths that only look like Desktop source', () => {
    expect(
      findDesktopSources([
        'src/desktopish/x.ts',
        'src/tools/desktopTools.ts',
        'src/web/desktop/x.ts',
        'node_modules/pkg/src/desktop/x.js',
        'src/desktop.ts',
        'src/index.combined.test.ts',
      ]),
    ).toEqual([]);
  });

  it('matches Windows-style paths', () => {
    const paths = [
      'src\\desktop\\xmlElement.ts',
      'src\\tools\\desktop\\tools.ts',
      'resources\\desktop\\knowledge\\x.md',
      'src\\server.desktop.ts',
      'src\\index.combined.ts',
    ];
    expect(findDesktopSources(paths)).toEqual(paths);
  });
});
