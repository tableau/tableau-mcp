import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRequestWorkbookUploadTool } from './requestWorkbookUpload.js';
import { MAX_STAGED_WORKBOOK_BYTES } from './stagedWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockRequestStagedWorkbookUpload: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('./stagedWorkbookUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedWorkbookUpload.js')>()),
  requestStagedWorkbookUpload: mocks.mockRequestStagedWorkbookUpload,
}));

describe('requestWorkbookUploadTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockRequestStagedWorkbookUpload.mockResolvedValue({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a tool instance with staged upload properties', () => {
    const tool = getRequestWorkbookUploadTool(new WebMcpServer());

    expect(tool.name).toBe('request-workbook-upload');
    expect(tool.description).toContain('staged upload URL');
    expect(tool.paramsSchema).toMatchObject({
      fileName: expect.any(Object),
    });
  });

  it('is disabled when the authoring-tools feature flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getRequestWorkbookUploadTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('returns a staged upload URL when S3 is configured', async () => {
    const result = await getToolResult({
      fileName: 'BoltBikes Workbook.twb',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
    expect(mocks.mockRequestStagedWorkbookUpload).toHaveBeenCalledWith({
      fileName: 'BoltBikes Workbook.twb',
      config: expect.objectContaining({
        enabled: true,
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
      }),
    });
  });

  it('returns an error when S3 is not configured', async () => {
    const result = await getToolResult(
      { fileName: 'BoltBikes Workbook.twb' },
      {
        config: {
          ...getMockRequestHandlerExtra().config,
          bucketS3: {
            enabled: false,
            bucket: '',
            region: '',
            keyPrefix: '',
            presignTtlSeconds: 60,
          },
        },
      },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('MCP_S3_BUCKET must be configured');
    expect(mocks.mockRequestStagedWorkbookUpload).not.toHaveBeenCalled();
  });

  it('returns an error for Passthrough auth before creating a signed upload URL', async () => {
    const result = await getToolResult(
      { fileName: 'BoltBikes Workbook.twb' },
      {
        tableauAuthInfo: {
          type: 'Passthrough',
          username: 'viewer@example.com',
          userId: 'test-user-id',
          server: 'https://tableau.example.com',
          siteId: 'test-site-id',
          siteName: 'test-site',
          raw: 'passthrough-token',
        },
      },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Passthrough authentication');
    expect(mocks.mockRequestStagedWorkbookUpload).not.toHaveBeenCalled();
  });

  it('redacts no presigned URL from logs because it is only produced after execution', async () => {
    const tool = getRequestWorkbookUploadTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        fileName: 'BoltBikes Workbook.twb',
      },
      getMockExtra(),
    );

    expect(logAndExecute.mock.calls[0][0].args).toEqual({
      fileName: 'BoltBikes Workbook.twb',
      contentType: 'application/xml',
    });
  });
});

async function getToolResult(
  params: { fileName: string },
  extraOverrides: Parameters<typeof getMockExtra>[0] = {},
): Promise<CallToolResult> {
  const tool = getRequestWorkbookUploadTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      fileName: params.fileName,
    },
    getMockExtra(extraOverrides),
  );
}

function getMockExtra(
  overrides: Partial<ReturnType<typeof getMockRequestHandlerExtra>> = {},
): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
  return {
    ...extra,
    ...overrides,
    config: {
      ...extra.config,
      bucketS3: {
        enabled: true,
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
        keyPrefix: 'mcp/',
        presignTtlSeconds: 300,
      },
      ...overrides.config,
    },
  };
}
