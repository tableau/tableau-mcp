import { build } from 'esbuild';
import { readdirSync } from 'fs';
import { join, relative, resolve } from 'path';

function productionModules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionModules(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('shared and local tool runtime boundary', () => {
  it('bundles without Desktop, host config, session, server, or network modules', async () => {
    const srcRoot = resolve(process.cwd(), 'src');
    const entries = [
      ...productionModules(join(srcRoot, 'tools/shared')),
      ...productionModules(join(srcRoot, 'tools/local')),
    ];
    const bundled = await build({
      entryPoints: entries,
      bundle: true,
      packages: 'external',
      platform: 'node',
      format: 'esm',
      outdir: 'build-boundary-test',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    const inputs = Object.keys(bundled.metafile.inputs).map((input) =>
      relative(srcRoot, resolve(process.cwd(), input)).replaceAll('\\', '/'),
    );
    const forbidden = inputs.filter(
      (input) =>
        input.startsWith('desktop/') ||
        input.startsWith('tools/desktop/') ||
        input.startsWith('tools/web/') ||
        input.startsWith('server/') ||
        input.startsWith('sdks/') ||
        [
          'config.ts',
          'config.desktop.ts',
          'server.desktop.ts',
          'server.web.ts',
          'sessions.ts',
          'errors/mcpToolError.ts',
        ].includes(input),
    );

    expect(entries.some((entry) => entry.endsWith('/shared/buildWorksheetXml.ts'))).toBe(true);
    expect(entries.some((entry) => entry.endsWith('/local/listFields.ts'))).toBe(true);
    expect(forbidden).toEqual([]);
  });
});
