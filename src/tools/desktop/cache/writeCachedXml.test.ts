import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getWriteCachedXmlTool } from './writeCachedXml.js';

vi.mock('../../../desktop/cache.js');
vi.mock('fs');

import { writeFileSync } from 'fs';

import { DesktopCache } from '../../../desktop/cache.js';

const CACHE_DIR = resolve('/tmp/test-cache');
const CACHED_FILE = `${CACHE_DIR}/worksheet-session-1.xml`;
const VALID_XML = '<worksheet name="Sheet1"><table/></worksheet>';
const MALFORMED_XML = '<worksheet name="Sheet1"><table></worksheet>';

function setupCacheMock() {
  vi.mocked(DesktopCache).mockImplementation(
    () =>
      ({
        getCacheFilePath: ({ prefix, id }: { prefix: string; id?: string }) =>
          `${CACHE_DIR}/${prefix}-${id ?? 'default'}.xml`,
      }) as unknown as DesktopCache,
  );
}

describe('writeCachedXmlTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCacheMock();
    vi.mocked(writeFileSync).mockImplementation(() => {});
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getWriteCachedXmlTool(new DesktopMcpServer());
    expect(tool.name).toBe('write-cached-xml');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool.paramsSchema).toMatchObject({
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
});

async function getResult(filePath: string, xmlContent: string): Promise<CallToolResult> {
  const tool = getWriteCachedXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ filePath, xmlContent }, getMockRequestHandlerExtra());
}
