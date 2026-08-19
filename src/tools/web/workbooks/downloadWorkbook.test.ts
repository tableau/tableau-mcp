import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFile, rm } from 'fs/promises';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDownloadWorkbookTool } from './downloadWorkbook.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockDownloadWorkbook: vi.fn(),
  mockUploadBufferToS3: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        downloadWorkbook: mocks.mockDownloadWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../s3Client.js', async (importActual) => ({
  ...(await importActual<typeof import('../s3Client.js')>()),
  uploadBufferToS3: mocks.mockUploadBufferToS3,
}));

vi.mock('../../../logging/logger.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../logging/logger.js')>()),
  log: mocks.mockLog,
}));

describe('downloadWorkbookTool', () => {
  const tempPathsToCleanup: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempPathsToCleanup.splice(0).map(async (path) => rm(path, { force: true })));
  });

  it('should create a tool instance with correct properties', () => {
    const downloadWorkbookTool = getDownloadWorkbookTool(new WebMcpServer());
    expect(downloadWorkbookTool.name).toBe('download-workbook');
    expect(downloadWorkbookTool.description).toContain('Downloads workbook content');
    expect(downloadWorkbookTool.paramsSchema).toMatchObject({
      workbookId: expect.any(Object),
      includeExtract: expect.any(Object),
    });
  });

  it('should write workbook bytes to a temp path when S3 is not configured', async () => {
    const workbookBytes = Buffer.from('<workbook/>', 'utf-8');
    mocks.mockDownloadWorkbook.mockResolvedValue({
      content: workbookBytes,
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeExtract: false,
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockDownloadWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeExtract: false,
    });
    expect(result.content).toHaveLength(1);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.filename).toBe('Superstore.twb');
    expect(payload.mimeType).toBe('application/xml');
    expect(payload.path).toMatch(/tableau-mcp-workbooks/);
    tempPathsToCleanup.push(payload.path);
    await expect(readFile(payload.path)).resolves.toEqual(workbookBytes);
    expect(mocks.mockUploadBufferToS3).not.toHaveBeenCalled();
  });

  it('should return an S3 resource link when MCP_S3_BUCKET is configured', async () => {
    vi.stubEnv('MCP_S3_BUCKET', 'tableau-data');
    const workbookBytes = Buffer.from('<workbook/>', 'utf-8');
    mocks.mockDownloadWorkbook.mockResolvedValue({
      content: workbookBytes,
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });
    mocks.mockUploadBufferToS3.mockResolvedValue('https://s3.example.com/signed-url');

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeExtract: false,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'resource_link');
    expect(result.content[0].uri).toBe('https://s3.example.com/signed-url');
    expect(result.content[0].name).toBe('Superstore.twb');
    expect(result.content[0].mimeType).toBe('application/xml');
    expect(mocks.mockUploadBufferToS3).toHaveBeenCalledWith(
      workbookBytes,
      expect.objectContaining({
        contentType: 'application/xml',
        bucket: 'tableau-data',
        key: expect.stringMatching(
          /^workbook-files\/96a43833-27db-40b6-aa80-751efc776b9a\/.+\.twb$/,
        ),
      }),
    );
  });

  it('should fall back to temp path and log warning when S3 upload fails', async () => {
    vi.stubEnv('MCP_S3_BUCKET', 'tableau-data');
    const workbookBytes = Buffer.from('<workbook/>', 'utf-8');
    mocks.mockDownloadWorkbook.mockResolvedValue({
      content: workbookBytes,
      contentType: 'application/xml',
      filename: 'Superstore.twb',
    });
    mocks.mockUploadBufferToS3.mockRejectedValue(new Error('access denied'));

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
      includeExtract: false,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    tempPathsToCleanup.push(payload.path);
    await expect(readFile(payload.path)).resolves.toEqual(workbookBytes);
    expect(mocks.mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('access denied'),
      }),
    );
  });

  it('should return workbook not allowed error when workbook is not allowed', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('is not allowed');
    expect(mocks.mockDownloadWorkbook).not.toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    mocks.mockDownloadWorkbook.mockRejectedValue(new Error('API Error'));

    const result = await getToolResult({
      workbookId: '96a43833-27db-40b6-aa80-751efc776b9a',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('API Error');
  });
});

async function getToolResult(params: {
  workbookId: string;
  includeExtract?: boolean;
}): Promise<CallToolResult> {
  const downloadWorkbookTool = getDownloadWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(downloadWorkbookTool.callback);
  return await callback(
    {
      workbookId: params.workbookId,
      includeExtract: params.includeExtract,
    },
    getMockRequestHandlerExtra(),
  );
}
