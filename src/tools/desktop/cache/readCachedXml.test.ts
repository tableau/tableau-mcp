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

function setupCacheMock() {
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
    vi.mocked(readFileSync).mockReturnValue(SAMPLE_XML as unknown as Buffer);
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
});

async function getResult(filePath: string): Promise<CallToolResult> {
  const tool = getReadCachedXmlTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ filePath }, getMockRequestHandlerExtra());
}
