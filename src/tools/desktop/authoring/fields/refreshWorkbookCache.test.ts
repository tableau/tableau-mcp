import { Ok } from 'ts-results-es';

import * as cachePathModule from '../../../../desktop/cachePath.js';
import { REDACTED_CREDENTIAL_SENTINEL } from '../../../../desktop/limits/datasourceCredentialRedaction.js';
import { sourceSha256, writeSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { refreshWorkbookCache } from './refreshWorkbookCache.js';

vi.mock('../../../../desktop/cachePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof cachePathModule>()),
  resolveCacheFileArg: vi.fn(),
  writeCacheFileArg: vi.fn(),
}));
vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/cacheFingerprint.js');

describe('refreshWorkbookCache', () => {
  it('rewrites the cache file with redacted connection credentials', async () => {
    vi.mocked(cachePathModule.resolveCacheFileArg).mockReturnValue(Ok('/cache/workbook.xml'));
    vi.mocked(cachePathModule.writeCacheFileArg).mockReturnValue(Ok('/cache/workbook.xml'));
    const live = "<workbook><connection password='hunter2'/></workbook>";
    vi.mocked(sourceSha256).mockImplementation((text: string) => `hash:${text}`);
    vi.mocked(getWorkbookXml).mockResolvedValue(Ok(live));
    const extra = getMockRequestHandlerExtra();
    extra.getExecutor = vi.fn().mockResolvedValue({});

    const result = await refreshWorkbookCache({
      extra,
      workbookFile: '/cache/workbook.xml',
      resolvedSession: '1',
      action: 'test',
    });

    expect(result.ok).toBe(true);
    const written = vi.mocked(cachePathModule.writeCacheFileArg).mock.calls[0][2];
    expect(written).not.toContain('hunter2');
    expect(written).toContain(REDACTED_CREDENTIAL_SENTINEL);
    expect(vi.mocked(writeSidecar).mock.calls[0][2]).toBe(`hash:${live}`);
  });
});
