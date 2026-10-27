import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { DesktopCache } from '../../../desktop/cache.js';
import { getCacheDir } from '../../../desktop/cachePath.js';
import { finishXmlRead } from './xmlReadResult.js';

describe('finishXmlRead cache write', () => {
  const temporaryPaths: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const path of temporaryPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('refuses a symlink planted at the cache path and leaves the target unchanged', () => {
    const outside = mkdtempSync(join(tmpdir(), 'xml-read-outside-'));
    const inside = mkdtempSync(join(getCacheDir(), 'xml-read-'));
    temporaryPaths.push(outside, inside);
    const target = join(outside, 'target.xml');
    writeFileSync(target, 'original');
    const planted = join(inside, 'workbook.xml');
    symlinkSync(target, planted);
    vi.spyOn(DesktopCache.prototype, 'getCacheFilePath').mockReturnValue(planted);

    expect(() =>
      finishXmlRead({
        kind: 'workbook',
        artifactKind: 'workbook',
        label: 'Workbook',
        inlineKey: 'workbookXml',
        toolName: 'get-workbook-xml',
        applyTool: 'apply-workbook',
        pathParam: 'workbookFile',
        xml: '<workbook/>',
        mode: 'file',
        capBytes: 1_000_000,
        resolvedSession: '7',
      }),
    ).toThrow(/refused to write/);
    expect(readFileSync(target, 'utf-8')).toBe('original');
  });
});
