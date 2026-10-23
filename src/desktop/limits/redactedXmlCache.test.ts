import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '../..');

const ALLOWED: Record<string, string> = {
  'desktop/cachePath.ts': 'defines the raw writers',
  'tools/desktop/local/cache/cachePath.ts': 're-exports the contained writer, no XML written',
  'desktop/limits/redactedXmlCache.ts': 'the redacting writers',
  'desktop/wrappers/cacheFingerprint.ts': 'writes the JSON sidecar, not XML',
  'tools/desktop/authoring/fields/worksheetEditBuffer.ts': 'writes a JSON pointer, not XML',
  'tools/desktop/local/cache/writeCachedXml.ts':
    'model-supplied XML: redacting would make apply refuse what the user wrote',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|testUtils)\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe('XML cache writes', () => {
  it('only allowlisted files name a raw cache writer', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => !(file in ALLOWED))
      .filter((file) =>
        /\b(writeCacheTextFile|writeCacheFileArg|writeContainedCacheTextFile)\b/.test(
          readFileSync(join(SRC, file), 'utf-8'),
        ),
      );

    expect(offenders).toEqual([]);
  });
});
