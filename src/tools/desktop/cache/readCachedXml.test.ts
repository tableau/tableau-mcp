import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getReadCachedXmlTool } from './readCachedXml.js';

vi.mock('../../../desktop/cache.js');
vi.mock('fs');

import { existsSync, readFileSync } from 'fs';

import { DesktopCache } from '../../../desktop/cache.js';

const CACHE_DIR = resolve('/tmp/test-cache');
const CACHED_FILE = `${CACHE_DIR}/worksheet-session-1.xml`;
const SAMPLE_XML = '<worksheet name="Sheet1"><table/></worksheet>';

function setupCacheMock(): void {
  vi.mocked(DesktopCache).mockImplementation(
    () =>
      ({
        getCacheFilePath: ({ prefix, id }: { prefix: string; id?: string }) =>
          `${CACHE_DIR}/${prefix}-${id ?? 'default'}.xml`,
      }) as unknown as DesktopCache,
  );
}

describe('readCachedXmlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCacheMock();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(SAMPLE_XML);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getReadCachedXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('read-cached-xml');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool.paramsSchema).toMatchObject({ filePath: expect.any(Object) });
  });

  it('should read and return XML content on success', async () => {
    const result = await getResult(CACHED_FILE);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(SAMPLE_XML);
    expect(result.content[0].text).toContain(CACHED_FILE);
  });

  it('should report byte count in success message', async () => {
    const result = await getResult(CACHED_FILE);

    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(`${SAMPLE_XML.length} bytes`);
  });

  it('should return error when file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult(CACHED_FILE);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not found');
  });

  it('should return security error for path outside cache directory', async () => {
    const outsidePath = resolve('/etc/passwd');
    const result = await getResult(outsidePath);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Security error');
    expect(result.content[0].text).toContain(outsidePath);
  });

  it('should reject a sibling path that shares the cache-dir prefix', async () => {
    // `/tmp/test-cache-evil/...` and `/tmp/test-cacheXYZ.xml` share the prefix
    // `/tmp/test-cache` but are outside it — the old startsWith check let them through.
    for (const escape of [
      resolve(`${CACHE_DIR}-evil/secret.xml`),
      resolve(`${CACHE_DIR}XYZ.xml`),
    ]) {
      const result = await getResult(escape);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Security error');
    }
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('should return error when readFileSync throws', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await getResult(CACHED_FILE);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Permission denied');
  });

  describe('slice selectors (no-dead-end read)', () => {
    const WORKBOOK =
      '<workbook><worksheets>' +
      "<worksheet name='Sales'><table><rows>[Sales]</rows></table></worksheet>" +
      "<worksheet name='Profit'><table><rows>[Profit]</rows></table></worksheet>" +
      '</worksheets>' +
      "<dashboards><dashboard name='Main'><zones><zone name='Sales'/></zones></dashboard></dashboards>" +
      '</workbook>';

    beforeEach(() => {
      vi.mocked(readFileSync).mockReturnValue(WORKBOOK);
    });

    it('returns only the selected worksheet element, not the whole file', async () => {
      const result = await getResult(CACHED_FILE, { worksheet: 'Sales' });

      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('[Sales]');
      expect(result.content[0].text).not.toContain('[Profit]');
    });

    it('returns only the selected dashboard element', async () => {
      const result = await getResult(CACHED_FILE, { dashboard: 'Main' });

      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain("<zone name='Sales'/>");
      expect(result.content[0].text).not.toContain('[Profit]');
    });

    it('returns a byte range slice', async () => {
      const result = await getResult(CACHED_FILE, { startByte: 0, endByte: 10 });

      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(WORKBOOK.slice(0, 10));
    });

    it('errors when the selected worksheet is absent', async () => {
      const result = await getResult(CACHED_FILE, { worksheet: 'Nope' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Nope');
    });
  });

  describe('ambiguous selector rejection (Andy-lens "please")', () => {
    beforeEach(() => {
      vi.mocked(readFileSync).mockReturnValue(SAMPLE_XML);
    });

    it('rejects worksheet + dashboard, naming both selectors, without reading', async () => {
      const result = await getResult(CACHED_FILE, { worksheet: 'Sales', dashboard: 'Main' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('worksheet');
      expect(result.content[0].text).toContain('dashboard');
      expect(readFileSync).not.toHaveBeenCalled();
    });

    it('rejects worksheet + byte range, naming both selectors received', async () => {
      const result = await getResult(CACHED_FILE, {
        worksheet: 'Sales',
        startByte: 0,
        endByte: 10,
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('worksheet');
      expect(result.content[0].text).toMatch(/byte/i);
    });

    it('rejects dashboard + byte range', async () => {
      const result = await getResult(CACHED_FILE, { dashboard: 'Main', endByte: 10 });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('dashboard');
      expect(result.content[0].text).toMatch(/byte/i);
    });

    it('leaves the single worksheet selector path unchanged', async () => {
      vi.mocked(readFileSync).mockReturnValue(
        '<workbook><worksheets>' +
          "<worksheet name='Sales'><rows>[Sales]</rows></worksheet>" +
          '</worksheets></workbook>',
      );
      const result = await getResult(CACHED_FILE, { worksheet: 'Sales' });

      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('[Sales]');
    });

    it('leaves the single byte-range selector path (startByte + endByte) unchanged', async () => {
      const result = await getResult(CACHED_FILE, { startByte: 0, endByte: 5 });

      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(SAMPLE_XML.slice(0, 5));
    });
  });
});

async function getResult(
  filePath: string,
  selectors: {
    worksheet?: string;
    dashboard?: string;
    startByte?: number;
    endByte?: number;
  } = {},
): Promise<CallToolResult> {
  const tool = getReadCachedXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      filePath,
      worksheet: selectors.worksheet,
      dashboard: selectors.dashboard,
      startByte: selectors.startByte,
      endByte: selectors.endByte,
    },
    getMockRequestHandlerExtra(),
  );
}
