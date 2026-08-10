import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { persistDownloadedWorkbook } from './downloadedWorkbookFile.js';
import { getDownloadWorkbookTool } from './downloadWorkbook.js';

const mocks = vi.hoisted(() => ({
  downloadWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'test-site-id',
      workbooksMethods: { downloadWorkbook: mocks.downloadWorkbook },
    }),
  ),
}));

vi.mock('./downloadedWorkbookFile.js', () => ({
  persistDownloadedWorkbook: vi.fn(),
}));

describe('getDownloadWorkbookTool', () => {
  it('declares the workbook download contract and required scopes', async () => {
    const tool = getDownloadWorkbookTool(new WebMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema)).strict();

    expect(tool.name).toBe('download-workbook');
    expect(tool.annotations).toEqual({
      title: 'Download Workbook',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.requiredApiScopes).toEqual([
      'tableau:workbooks:download',
      'tableau:content:read',
      'tableau:mcp_site_settings:read',
    ]);
    expect(schema.safeParse({ workbookId: 'workbook-id' }).success).toBe(true);
    expect(schema.safeParse({ workbookId: 'workbook-id', includeExtract: true }).success).toBe(
      true,
    );
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('downloads without extracts by default and returns the local artifact metadata', async () => {
    const downloadedWorkbook = { content: Readable.from(Buffer.from('<workbook />')) };
    mocks.downloadWorkbook.mockResolvedValue(downloadedWorkbook);
    vi.mocked(persistDownloadedWorkbook).mockResolvedValue({
      workbookFilePath: '/tmp/tableau-mcp-workbook-1/Sales.twb',
      fileName: 'Sales.twb',
      fileType: 'twb',
      sizeBytes: 42,
    });
    vi.spyOn(resourceAccessChecker, 'isWorkbookAllowed').mockResolvedValue({ allowed: true });

    const result = await getToolResult({ workbookId: 'workbook-id' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      workbookFilePath: '/tmp/tableau-mcp-workbook-1/Sales.twb',
      fileName: 'Sales.twb',
      fileType: 'twb',
      sizeBytes: 42,
      includeExtract: false,
    });
    expect(mocks.downloadWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: 'workbook-id',
      includeExtract: false,
    });
    expect(persistDownloadedWorkbook).toHaveBeenCalledWith(downloadedWorkbook);
    expect(useRestApi).toHaveBeenCalledWith(
      expect.objectContaining({
        jwtScopes: [
          'tableau:workbooks:download',
          'tableau:content:read',
          'tableau:mcp_site_settings:read',
        ],
      }),
    );
  });

  it('passes includeExtract through when requested', async () => {
    mocks.downloadWorkbook.mockResolvedValue({
      content: Readable.from(Buffer.from('packaged workbook')),
    });
    vi.mocked(persistDownloadedWorkbook).mockResolvedValue({
      workbookFilePath: '/tmp/tableau-mcp-workbook-1/Sales.twbx',
      fileName: 'Sales.twbx',
      fileType: 'twbx',
      sizeBytes: 100,
    });
    vi.spyOn(resourceAccessChecker, 'isWorkbookAllowed').mockResolvedValue({ allowed: true });

    await getToolResult({ workbookId: 'workbook-id', includeExtract: true });

    expect(mocks.downloadWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ includeExtract: true }),
    );
  });

  it('does not download a workbook excluded by bounded context', async () => {
    vi.spyOn(resourceAccessChecker, 'isWorkbookAllowed').mockResolvedValue({
      allowed: false,
      message: 'Workbook is outside the allowed context.',
    });

    const result = await getToolResult({ workbookId: 'workbook-id' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Workbook is outside the allowed context.',
    });
    expect(useRestApi).not.toHaveBeenCalled();
  });
});

async function getToolResult({
  workbookId,
  includeExtract,
}: {
  workbookId: string;
  includeExtract?: boolean;
}): Promise<CallToolResult> {
  vi.clearAllMocks();
  const tool = getDownloadWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ workbookId, includeExtract }, getMockRequestHandlerExtra());
}
