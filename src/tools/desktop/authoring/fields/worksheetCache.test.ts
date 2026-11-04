import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { DesktopCache } from '../../../../desktop/cache.js';
import { REDACTED_CREDENTIAL_SENTINEL } from '../../../../desktop/limits/datasourceCredentialRedaction.js';
import { getWorksheetXml } from '../../../../desktop/wrappers/getWorksheetXml.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { distinctCacheId, fetchAndCacheWorksheet } from './worksheetCache.js';

const state = vi.hoisted(() => ({ cacheDir: '' }));

vi.mock('../../../../desktop/cache.js', () => ({
  DesktopCache: class {
    getCacheFilePath({ prefix, id }: { prefix: string; id?: string }): string {
      return join(state.cacheDir, `${prefix}-${id ?? 'default'}.xml`);
    }
  },
}));
vi.mock('../../../../desktop/wrappers/getWorksheetXml.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../desktop/wrappers/getWorksheetXml.js')>()),
  getWorksheetXml: vi.fn(),
}));
vi.mock('../../../../desktop/wrappers/cacheFingerprint.js', () => ({
  sourceSha256: () => 'x',
  writeSidecar: vi.fn(),
}));

describe('distinctCacheId', () => {
  it('separates names that sanitize to the same string', () => {
    expect(distinctCacheId('Sales 2024', '1')).not.toBe(distinctCacheId('Sales-2024', '1'));
  });

  it('separates names that sanitize to nothing', () => {
    expect(distinctCacheId('売上', '1')).not.toBe(distinctCacheId('利益', '1'));
  });

  it('is stable for the same name and session, and separates sessions', () => {
    expect(distinctCacheId('Sales', '1')).toBe(distinctCacheId('Sales', '1'));
    expect(distinctCacheId('Sales', '1')).not.toBe(distinctCacheId('Sales', '2'));
  });

  it('keeps a long name within a bounded file name', () => {
    expect(distinctCacheId('x'.repeat(500), '1').length).toBeLessThan(120);
  });
});

describe.skipIf(process.platform === 'win32')('fetchAndCacheWorksheet cache write', () => {
  it('refuses a symlink planted at the target and leaves the outside file alone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-cache-'));
    try {
      state.cacheDir = join(root, 'cache');
      mkdirSync(state.cacheDir);
      const victim = join(root, 'victim.txt');
      writeFileSync(victim, 'precious');
      const target = new DesktopCache().getCacheFilePath({ prefix: 'worksheet-Sheet1' });
      symlinkSync(victim, target);
      vi.mocked(getWorksheetXml).mockResolvedValue(
        new Ok({ xml: '<worksheet name="Sheet1"/>', name: 'Sheet1' }),
      );
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn().mockResolvedValue({});

      await expect(
        fetchAndCacheWorksheet({ worksheetName: 'Sheet1', resolvedSession: '1', extra }),
      ).rejects.toThrow(/refused to write[\s\S]*\nReason: symlink/);
      expect(readFileSync(victim, 'utf-8')).toBe('precious');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('fetchAndCacheWorksheet redaction', () => {
  it('writes the worksheet cache with connection credentials redacted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-cache-'));
    try {
      state.cacheDir = root;
      vi.mocked(getWorksheetXml).mockResolvedValue(
        new Ok({
          xml: "<worksheet name='S'><connection password='hunter2' username='y'/></worksheet>",
          name: 'S',
        }),
      );
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn().mockResolvedValue({});

      const result = await fetchAndCacheWorksheet({
        worksheetName: 'S',
        resolvedSession: '1',
        extra,
      });

      const onDisk = readFileSync(result.unwrap(), 'utf-8');
      expect(onDisk).not.toContain('hunter2');
      expect(onDisk).toContain(REDACTED_CREDENTIAL_SENTINEL);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
