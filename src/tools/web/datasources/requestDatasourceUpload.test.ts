import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRequestDatasourceUploadTool } from './requestDatasourceUpload.js';
import { MAX_STAGED_DATASOURCE_BYTES } from './stagedDatasourceUpload.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockRequestStagedDatasourceUpload: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('./stagedDatasourceUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedDatasourceUpload.js')>()),
  requestStagedDatasourceUpload: mocks.mockRequestStagedDatasourceUpload,
}));

describe('requestDatasourceUploadTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockRequestStagedDatasourceUpload.mockResolvedValue({
      datasourceUploadId: '123e4567-e89b-42d3-a456-426614174000',
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_DATASOURCE_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a tool instance with staged upload properties', () => {
    const tool = getRequestDatasourceUploadTool(new WebMcpServer());

    expect(tool.name).toBe('request-datasource-upload');
    expect(tool.description).toContain('staged upload URL');
    expect(tool.paramsSchema).toMatchObject({
      fileName: expect.any(Object),
    });
  });

  it('is enabled when the authoring-tools flag is ON for ChatGPT', async () => {
    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://chatgpt.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('is enabled when the authoring-tools flag is ON for a non-Slack client', async () => {
    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://claude.ai/mcp' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the authoring-tools flag is ON for Slack', async () => {
    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled when the authoring-tools flag is ON and there is no OAuth client id (stdio)', async () => {
    const tool = getRequestDatasourceUploadTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the authoring-tools feature flag is OFF even for a non-Slack client', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getRequestDatasourceUploadTool(
      new WebMcpServer({ clientId: 'https://claude.ai/mcp' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('returns a staged upload URL when S3 is configured', async () => {
    const result = await getToolResult({
      fileName: 'Superstore.tds',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      datasourceUploadId: '123e4567-e89b-42d3-a456-426614174000',
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_DATASOURCE_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
    expect(mocks.mockRequestStagedDatasourceUpload).toHaveBeenCalledWith({
      fileName: 'Superstore.tds',
      config: expect.objectContaining({
        enabled: true,
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
      }),
    });
  });

  it('returns a staged upload URL for a .tdsx filename', async () => {
    mocks.mockRequestStagedDatasourceUpload.mockResolvedValue({
      datasourceUploadId: '123e4567-e89b-42d3-a456-426614174000',
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_DATASOURCE_BYTES,
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
    });

    const result = await getToolResult({
      fileName: 'Superstore.tdsx',
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockRequestStagedDatasourceUpload).toHaveBeenCalledWith({
      fileName: 'Superstore.tdsx',
      config: expect.objectContaining({ enabled: true }),
    });
  });

  it('returns an error when S3 is not configured', async () => {
    const result = await getToolResult(
      { fileName: 'Superstore.tds' },
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
    expect(mocks.mockRequestStagedDatasourceUpload).not.toHaveBeenCalled();
  });

  it('returns an error for Passthrough auth before creating a signed upload URL', async () => {
    const result = await getToolResult(
      { fileName: 'Superstore.tds' },
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
    expect(mocks.mockRequestStagedDatasourceUpload).not.toHaveBeenCalled();
  });
});

async function getToolResult(
  params: { fileName: string },
  extraOverrides: Parameters<typeof getMockExtra>[0] = {},
): Promise<CallToolResult> {
  const tool = getRequestDatasourceUploadTool(new WebMcpServer());
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
