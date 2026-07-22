import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';

import * as configModule from '../../../config.desktop.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getWriteCachedXmlTool } from './writeCachedXml.js';

vi.mock('../../../desktop/cache.js');
vi.mock('../../../desktop/commands/workbook/cacheFingerprint.js');
vi.mock('../../../desktop/externalApi/discovery.js');
vi.mock('fs');

import { existsSync, readFileSync, writeFileSync } from 'fs';

import { DesktopCache } from '../../../desktop/cache.js';
import * as cacheFingerprintModule from '../../../desktop/commands/workbook/cacheFingerprint.js';
import * as discoveryModule from '../../../desktop/externalApi/discovery.js';

const CACHE_DIR = resolve('/tmp/test-cache');
const CACHED_FILE = `${CACHE_DIR}/worksheet-session-1.xml`;
const SESSION = '12345';
const VALID_XML = '<worksheet name="Sheet1"><table/></worksheet>';
const MALFORMED_XML = '<worksheet name="Sheet1"><table></worksheet>';

function setupCacheMock(): void {
  vi.mocked(DesktopCache).mockImplementation(
    () =>
      ({
        getCacheFilePath: ({ prefix, id }: { prefix: string; id?: string }) =>
          `${CACHE_DIR}/${prefix}-${id ?? 'default'}.xml`,
      }) as unknown as DesktopCache,
  );
}

function mockPinnedSession(desktopSessionId: string | undefined): void {
  const base = new configModule.Config();
  vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
    ...base,
    desktopSessionId,
  } as configModule.Config);
}

describe('writeCachedXmlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCacheMock();
    mockPinnedSession(undefined);
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
    vi.mocked(writeFileSync).mockImplementation(() => {});
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getWriteCachedXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('write-cached-xml');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      filePath: expect.any(Object),
      xmlContent: expect.any(Object),
    });
  });

  it('should write well-formed XML and return success', async () => {
    const result = await getResult(CACHED_FILE, VALID_XML);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(CACHED_FILE);
    expect(result.content[0].text).toContain(`${VALID_XML.length} bytes`);
  });

  it('should call writeFileSync with correct args', async () => {
    await getResult(CACHED_FILE, VALID_XML);

    expect(writeFileSync).toHaveBeenCalledWith(resolve(CACHED_FILE), VALID_XML, 'utf-8');
  });

  it('writes a fingerprint sidecar after writing the cache file', async () => {
    await getResult(CACHED_FILE, VALID_XML);

    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(resolve(CACHED_FILE), SESSION);
  });

  it('stamps the sidecar with the pinned session, not the requested one', async () => {
    mockPinnedSession(SESSION);

    await getResult(CACHED_FILE, VALID_XML, {}, undefined);

    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(resolve(CACHED_FILE), SESSION);
  });

  it('rejects and writes no sidecar when the requested session is not a running instance', async () => {
    mockPinnedSession('99999');
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([
      { pid: 99999 } as ReturnType<typeof discoveryModule.discoverInstances>[number],
    ]);

    const result = await getResult(CACHED_FILE, VALID_XML, {}, SESSION);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(SESSION);
    expect(result.content[0].text).toContain('list-instances');
    expect(cacheFingerprintModule.writeSidecar).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should return error for malformed XML without writing', async () => {
    const result = await getResult(CACHED_FILE, MALFORMED_XML);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('validation failed');
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should return security error for path outside cache directory', async () => {
    const outsidePath = resolve('/etc/malicious.xml');
    const result = await getResult(outsidePath, VALID_XML);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Security error');
    expect(result.content[0].text).toContain(outsidePath);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should reject a sibling path that shares the cache-dir prefix', async () => {
    // `/tmp/test-cache-evil/...` and `/tmp/test-cacheXYZ.xml` share the prefix
    // `/tmp/test-cache` but are outside it — the old startsWith check let them through.
    for (const escape of [resolve(`${CACHE_DIR}-evil/x.xml`), resolve(`${CACHE_DIR}XYZ.xml`)]) {
      const result = await getResult(escape, VALID_XML);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Security error');
    }
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should mention apply-* tools in success message', async () => {
    const result = await getResult(CACHED_FILE, VALID_XML);

    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('apply-');
  });

  it('should return error when writeFileSync throws', async () => {
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error('Disk full');
    });

    const result = await getResult(CACHED_FILE, VALID_XML);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Disk full');
  });

  describe('element splice (targeted no-dead-end write)', () => {
    const WORKBOOK =
      '<workbook><worksheets>' +
      "<worksheet name='Sales'><table><rows>[Sales]</rows></table></worksheet>" +
      "<worksheet name='Profit'><table><rows>[Profit]</rows></table></worksheet>" +
      '</worksheets></workbook>';

    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(WORKBOOK);
    });

    it('splices the replacement element into the file, leaving siblings intact', async () => {
      const modified =
        "<worksheet name='Sales'><table><rows>[Sales Modified]</rows></table></worksheet>";

      const result = await getResult(CACHED_FILE, modified, { worksheet: 'Sales' });

      expect(result.isError).toBeFalsy();
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('[Sales Modified]');
      expect(written).toContain('[Profit]');
      expect(written).not.toContain('[Sales]</rows>');
    });

    it('errors (without writing) when the element to splice is absent', async () => {
      const result = await getResult(CACHED_FILE, "<worksheet name='Nope'/>", {
        worksheet: 'Nope',
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Nope');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('rejects a malformed replacement fragment without writing', async () => {
      const result = await getResult(CACHED_FILE, '<worksheet name="Sales"><table>', {
        worksheet: 'Sales',
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('validation failed');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('rejects (without writing) when the fragment name does not match the selector', async () => {
      // Selector says "Sales" but the replacement's outer element names "Profit" —
      // splicing would silently overwrite the wrong worksheet, so it must error.
      const result = await getResult(
        CACHED_FILE,
        "<worksheet name='Profit'><table><rows>[oops]</rows></table></worksheet>",
        { worksheet: 'Sales' },
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Sales');
      expect(result.content[0].text).toContain('Profit');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('rejects (without writing) when the fragment tag does not match the selector', async () => {
      // Selector is a worksheet but the fragment is a <dashboard>.
      const result = await getResult(CACHED_FILE, "<dashboard name='Sales'><zones/></dashboard>", {
        worksheet: 'Sales',
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('worksheet');
      expect(result.content[0].text).toContain('dashboard');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('rejects worksheet + dashboard selectors together, naming both, without writing', async () => {
      const result = await getResult(
        CACHED_FILE,
        "<worksheet name='Sales'><rows>[x]</rows></worksheet>",
        { worksheet: 'Sales', dashboard: 'Main' },
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('worksheet');
      expect(result.content[0].text).toContain('dashboard');
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it('leaves the single dashboard selector path unchanged', async () => {
      vi.mocked(readFileSync).mockReturnValue(
        "<workbook><dashboards><dashboard name='Main'><zones><zone name='Sales'/></zones></dashboard></dashboards></workbook>",
      );
      const result = await getResult(
        CACHED_FILE,
        "<dashboard name='Main'><zones><zone name='Profit'/></zones></dashboard>",
        { dashboard: 'Main' },
      );

      expect(result.isError).toBeFalsy();
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain("<zone name='Profit'/>");
    });

    it('splices when an entity-escaped fragment name matches a plain-text selector', async () => {
      vi.mocked(readFileSync).mockReturnValue(
        '<workbook><worksheets>' +
          '<worksheet name="Sales &amp; Profit"><rows>[old]</rows></worksheet>' +
          '</worksheets></workbook>',
      );
      const result = await getResult(
        CACHED_FILE,
        '<worksheet name="Sales &amp; Profit"><rows>[new]</rows></worksheet>',
        { worksheet: 'Sales & Profit' },
      );

      expect(result.isError).toBeFalsy();
      const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('[new]');
      expect(written).not.toContain('[old]');
    });
  });
});

async function getResult(
  filePath: string,
  xmlContent: string,
  selectors: { worksheet?: string; dashboard?: string } = {},
  ...requestedSession: [string | undefined] | []
): Promise<CallToolResult> {
  const session = (requestedSession.length > 0 ? requestedSession[0] : SESSION) as string;
  const tool = getWriteCachedXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session,
      filePath,
      xmlContent,
      worksheet: selectors.worksheet,
      dashboard: selectors.dashboard,
    },
    getMockRequestHandlerExtra(),
  );
}
