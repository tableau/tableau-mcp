import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { persistDownloadedWorkbook } from './downloadedWorkbookFile.js';
import { getDownloadWorkbookTool } from './downloadWorkbook.js';
import { uploadWorkbookToS3 } from './uploadWorkbookToS3.js';

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

vi.mock('./uploadWorkbookToS3.js', () => ({
  uploadWorkbookToS3: vi.fn(),
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  stubDefaultEnvVars();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDownloadWorkbookTool', () => {
  it('declares a TWB-only download contract and required scopes', async () => {
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
      false,
    );
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('excludes extracts and returns a local TWB artifact when S3 is not configured', async () => {
    vi.stubEnv('MCP_S3_BUCKET', '');
    const downloadedWorkbook = { content: Readable.from(Buffer.from('<workbook />')) };
    mocks.downloadWorkbook.mockResolvedValue(downloadedWorkbook);
    vi.mocked(persistDownloadedWorkbook).mockResolvedValue({
      workbookFilePath: '/tmp/tableau-mcp-workbook-1/Sales.twb',
      fileName: 'Sales.twb',
      fileType: 'twb',
      sourceFileType: 'twb',
      sizeBytes: 42,
    });
    vi.spyOn(resourceAccessChecker, 'isWorkbookAllowed').mockResolvedValue({ allowed: true });

    const result = await getToolResult({ workbookId: 'workbook-id' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      delivery: 'local',
      workbookFilePath: '/tmp/tableau-mcp-workbook-1/Sales.twb',
      fileName: 'Sales.twb',
      fileType: 'twb',
      sourceFileType: 'twb',
      sizeBytes: 42,
    });
    expect(mocks.downloadWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: 'workbook-id',
      includeExtract: false,
    });
    expect(persistDownloadedWorkbook).toHaveBeenCalledWith(downloadedWorkbook);
    expect(uploadWorkbookToS3).not.toHaveBeenCalled();
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

  it('uploads the normalized TWB to S3 and returns a resource link', async () => {
    vi.stubEnv('MCP_S3_BUCKET', 'tableau-artifacts');
    vi.stubEnv('MCP_IMAGE_PREFIX', 'tableau/');
    const downloadedWorkbook = { content: Readable.from(Buffer.from('package')) };
    mocks.downloadWorkbook.mockResolvedValue(downloadedWorkbook);
    vi.mocked(persistDownloadedWorkbook).mockResolvedValue({
      workbookFilePath: '/tmp/tableau-mcp-workbook-1/Sales.twb',
      fileName: 'Sales.twb',
      fileType: 'twb',
      sourceFileType: 'twbx',
      sizeBytes: 42,
    });
    vi.mocked(uploadWorkbookToS3).mockResolvedValue({
      url: 'https://s3.example.com/signed-url',
      fileName: 'Sales.twb',
      fileType: 'twb',
      sourceFileType: 'twbx',
      sizeBytes: 42,
    });
    vi.spyOn(resourceAccessChecker, 'isWorkbookAllowed').mockResolvedValue({ allowed: true });

    const result = await getToolResult({ workbookId: 'workbook-id' });

    expect(result.isError).toBe(false);
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'resource_link',
        uri: 'https://s3.example.com/signed-url',
        name: 'Sales.twb',
        mimeType: 'application/xml',
      }),
    ]);
    expect(result.structuredContent).toEqual({
      delivery: 'url',
      url: 'https://s3.example.com/signed-url',
      fileName: 'Sales.twb',
      fileType: 'twb',
      sourceFileType: 'twbx',
      sizeBytes: 42,
    });
    expect(uploadWorkbookToS3).toHaveBeenCalledWith(
      expect.objectContaining({ workbookFilePath: expect.any(String) }),
      {
        workbookId: 'workbook-id',
        config: expect.objectContaining({
          bucket: 'tableau-artifacts',
          keyPrefix: 'tableau/workbook-downloads/',
        }),
      },
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

async function getToolResult({ workbookId }: { workbookId: string }): Promise<CallToolResult> {
  vi.clearAllMocks();
  const tool = getDownloadWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ workbookId }, getMockRequestHandlerExtra());
}
