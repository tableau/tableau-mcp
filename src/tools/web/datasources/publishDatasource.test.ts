import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra, MOCK_SITE_LUID, MOCK_USER_LUID } from '../toolContext.mock.js';
import { getPublishDatasourceTool } from './publishDatasource.js';

const mocks = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockPublishDatasource: vi.fn(),
  mockUploadFileInChunks: vi.fn(),
  mockResolveStagedDatasourceUpload: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockIsBlobStorageEnabled: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.mockReadFile,
}));

vi.mock('../../../blobStorage/init.js', () => ({
  isBlobStorageEnabled: mocks.mockIsBlobStorageEnabled,
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      datasourcesMethods: {
        publishDatasource: mocks.mockPublishDatasource,
      },
      publishingMethods: {
        uploadFileInChunks: mocks.mockUploadFileInChunks,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('./stagedDatasourceUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./stagedDatasourceUpload.js')>()),
  resolveStagedDatasourceUpload: mocks.mockResolveStagedDatasourceUpload,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

const mockPublishedDatasource = {
  id: '2d935df8-fe7e-4fd8-bb14-35eb4ba31d45',
  name: 'My New Datasource',
  contentUrl: 'MyNewDatasource',
  webpageUrl: 'https://my-tableau-server.com/#/site/tc25/datasources/12345',
  project: { id: 'target-project-id', name: 'Marketing Analytics' },
  tags: {},
};

const validLuid = '7c1d2f3a-4b5e-4f60-8a7b-9c0d1e2f3a4b';

const validArgs = {
  datasourceUploadId: '123e4567-e89b-42d3-a456-426614174000',
  name: 'My New Datasource',
  projectId: 'target-project-id',
};

const validLocalArgs = {
  datasourceFilePath: '/tmp/source-superstore.tds',
  name: 'My New Datasource',
  projectId: 'target-project-id',
};

describe('publishDatasourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockPublishDatasource.mockReset();
    mocks.mockUploadFileInChunks.mockReset();
    mocks.mockResolveStagedDatasourceUpload.mockReset();
    mocks.mockReadFile.mockReset();
    mocks.mockIsBlobStorageEnabled.mockReset();
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    mocks.mockIsFeatureEnabled.mockReset();
    mocks.mockReadFile.mockResolvedValue(Buffer.from('<datasource source="local" />'));
    mocks.mockResolveStagedDatasourceUpload.mockResolvedValue({
      fileName: 'source-superstore.tds',
      bytes: Buffer.from('<datasource source="new" />'),
    });
    mocks.mockUploadFileInChunks.mockResolvedValue('chunked-upload-session-id');
    mocks.mockPublishDatasource.mockResolvedValue(mockPublishedDatasource);
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getPublishDatasourceTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('publish-datasource');
    expect(tool.description).toContain('Publishes a TDS or TDSX data source');
    expect(paramsSchema).toMatchObject({
      datasourceUploadId: expect.any(Object),
      datasourceFilePath: expect.any(Object),
      name: expect.any(Object),
      projectId: expect.any(Object),
      overwrite: expect.any(Object),
    });
    expect(annotations.destructiveHint).toBe(true);
    expect(paramsSchema.name.safeParse('').success).toBe(false);
    expect(paramsSchema.projectId.safeParse('target-project-id').success).toBe(false);
    expect(paramsSchema.projectId.safeParse(validLuid).success).toBe(true);
    expect(tool.description).toContain('specified Tableau project');
  });

  it('rejects a malformed projectId at the MCP schema layer before any file or API access', async () => {
    const { McpServer } = await vi.importActual<
      typeof import('@modelcontextprotocol/sdk/server/mcp.js')
    >('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const tool = getPublishDatasourceTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    server.registerTool(
      tool.name,
      { inputSchema: await Provider.from(tool.paramsSchema) },
      async (args) => callback(args, getMockExtra()),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const badProjectId = 'not-a-luid-../x';
      const rejected = (await client.callTool({
        name: 'publish-datasource',
        arguments: { ...validArgs, projectId: badProjectId },
      })) as CallToolResult;
      invariant(rejected.content[0].type === 'text');
      expect(rejected.isError).toBe(true);
      expect(rejected.content[0].text).toContain('Input validation error');
      expect(rejected.content[0].text).toContain('must be a Tableau LUID (UUID format)');
      expect(rejected.content[0].text).not.toContain(badProjectId);
      expect(mocks.mockReadFile).not.toHaveBeenCalled();
      expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
      expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
      expect(mocks.mockPublishDatasource).not.toHaveBeenCalled();

      const accepted = (await client.callTool({
        name: 'publish-datasource',
        arguments: { ...validArgs, projectId: validLuid },
      })) as CallToolResult;
      expect(accepted.isError).toBe(false);
      expect(mocks.mockPublishDatasource).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: validLuid }),
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('is enabled when the datasource-authoring flag is ON for a non-Slack client', async () => {
    const tool = getPublishDatasourceTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('datasource-authoring');
  });

  it('is disabled for Slack unless authoring-with-slack is enabled', async () => {
    mocks.mockIsFeatureEnabled.mockImplementation(
      async (featureName: string) => featureName === 'datasource-authoring',
    );
    const tool = getPublishDatasourceTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled for Slack when the datasource-authoring and authoring-with-slack flags are ON', async () => {
    const tool = getPublishDatasourceTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the datasource-authoring feature flag is OFF even for a non-Slack client', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getPublishDatasourceTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('datasource-authoring');
  });

  it('uploads and publishes a staged TDS to the requested project and returns the datasource', async () => {
    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.data.id).toBe(mockPublishedDatasource.id);
    expect(response.url).toBe(mockPublishedDatasource.webpageUrl);

    expect(mocks.mockResolveStagedDatasourceUpload).toHaveBeenCalledWith({
      datasourceUploadId: validArgs.datasourceUploadId,
      tenant: { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID },
    });
    expect(mocks.mockUploadFileInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.tds',
      content: Buffer.from('<datasource source="new" />'),
    });
    expect(mocks.mockPublishDatasource).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'chunked-upload-session-id',
      name: 'My New Datasource',
      datasourceType: 'tds',
      projectId: 'target-project-id',
      overwrite: false,
    });
  });

  it('uploads and publishes a staged TDSX file', async () => {
    mocks.mockResolveStagedDatasourceUpload.mockResolvedValue({
      fileName: 'source-superstore.tdsx',
      bytes: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    expect(mocks.mockUploadFileInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.tdsx',
      content: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });
    expect(mocks.mockPublishDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceType: 'tdsx' }),
    );
  });

  it('uploads and publishes a local TDSX data source file path', async () => {
    mocks.mockReadFile.mockResolvedValue(Buffer.from('PK\x03\x04-fake-zip-bytes'));

    const result = await getToolResult(
      { ...validLocalArgs, datasourceFilePath: '/tmp/source-superstore.tdsx' },
      { blobStorageEnabled: false },
    );

    expect(result.isError).toBe(false);
    expect(mocks.mockReadFile).toHaveBeenCalledWith('/tmp/source-superstore.tdsx');
    expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.tdsx',
      content: Buffer.from('PK\x03\x04-fake-zip-bytes'),
    });
    expect(mocks.mockPublishDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceType: 'tdsx' }),
    );
  });

  it('uploads and publishes a local TDS data source file path', async () => {
    const result = await getToolResult(validLocalArgs, { blobStorageEnabled: false });

    expect(result.isError).toBe(false);
    expect(mocks.mockReadFile).toHaveBeenCalledWith('/tmp/source-superstore.tds');
    expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.tds',
      content: Buffer.from('<datasource source="local" />'),
    });
  });

  it('defaults overwrite to false when publishing', async () => {
    await getToolResult(validArgs);

    expect(mocks.mockPublishDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: false }),
    );
  });

  it('passes overwrite true through when publishing', async () => {
    await getToolResult({ ...validArgs, overwrite: true });

    expect(mocks.mockPublishDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );
  });

  it('returns an error without overwriting when Tableau rejects a duplicate datasource name', async () => {
    mocks.mockPublishDatasource.mockRejectedValue(
      new Error('A datasource named My New Datasource already exists in the target project.'),
    );

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('already exists in the target project');
    expect(mocks.mockPublishDatasource).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My New Datasource', overwrite: false }),
    );
  });

  it('rejects local data source file paths when blob storage is configured', async () => {
    const result = await getToolResult(validLocalArgs, { blobStorageEnabled: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'datasourceFilePath is only supported when staged uploads are not configured',
    );
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('rejects local data source file paths on HTTP transport before signing in or reading the file', async () => {
    const result = await getToolResult(validLocalArgs, {
      blobStorageEnabled: false,
      transport: 'http',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'datasourceFilePath is only supported when the MCP server runs over stdio. On an HTTP server, stage the file with request-datasource-upload and pass datasourceUploadId; that requires the server to configure a blob storage provider.',
    );
    expect(useRestApi).not.toHaveBeenCalled();
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
    expect(mocks.mockPublishDatasource).not.toHaveBeenCalled();
  });

  it('rejects local data source file paths on HTTP transport even when blob storage is configured', async () => {
    const result = await getToolResult(validLocalArgs, {
      blobStorageEnabled: true,
      transport: 'http',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('only supported when the MCP server runs over stdio');
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockPublishDatasource).not.toHaveBeenCalled();
  });

  it('publishes a staged upload on HTTP transport', async () => {
    const result = await getToolResult(validArgs, { transport: 'http' });

    expect(result.isError).toBe(false);
    expect(mocks.mockPublishDatasource).toHaveBeenCalledOnce();
  });

  it('fails closed without resolving the staged upload when the session has no valid tenant LUIDs', async () => {
    const result = await getToolResult(validArgs, {
      transport: 'http',
      extraOverrides: { _siteLuid: '' },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Unable to determine the signed-in Tableau site and user',
    );
    // Returned as an Err from the useRestApi callback, not thrown.
    const callbackResult = await vi.mocked(useRestApi).mock.results[0].value;
    expect(callbackResult.isErr()).toBe(true);
    expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('returns an args-validation error when local data source path is neither tds nor tdsx', async () => {
    const result = await getToolResult(
      {
        ...validLocalArgs,
        datasourceFilePath: '/tmp/source-superstore.xml',
      },
      { blobStorageEnabled: false },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'datasourceFilePath must point to a .tds or .tdsx file',
    );
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('returns an args-validation error when local data source file is empty', async () => {
    mocks.mockReadFile.mockResolvedValue(Buffer.from(''));

    const result = await getToolResult(validLocalArgs, { blobStorageEnabled: false });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('datasourceFilePath must not point to an empty');
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('returns an error when both local path and staged upload id are provided', async () => {
    const result = await getToolResult({
      ...validLocalArgs,
      datasourceUploadId: validArgs.datasourceUploadId,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Provide either datasourceFilePath or datasourceUploadId, not both',
    );
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('returns an error when neither local path nor staged upload id is provided', async () => {
    const result = await getToolResult({ name: validArgs.name, projectId: validArgs.projectId });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Either datasourceFilePath or datasourceUploadId');
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('returns an error before uploading when the requested project is outside bounded context', async () => {
    const result = await getToolResult(validArgs, {
      boundedProjectIds: new Set(['different-project-id']),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed by this MCP server');
    expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
    expect(mocks.mockPublishDatasource).not.toHaveBeenCalled();
  });

  it('redacts staged datasourceUploadId details passed to shared logging', async () => {
    const tool = getPublishDatasourceTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        datasourceUploadId: '123e4567-e89b-42d3-a456-426614174000',
        datasourceFilePath: undefined,
        name: validArgs.name,
        projectId: validArgs.projectId,
        overwrite: false,
      },
      getMockRequestHandlerExtra(),
    );

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      datasourceUploadId: '<redacted>',
      datasourceFilePath: undefined,
      name: validArgs.name,
      projectId: validArgs.projectId,
      overwrite: false,
    });
    expect(JSON.stringify(loggedArgs)).not.toContain('123e4567-e89b-42d3-a456-426614174000');
  });
});

async function getToolResult(
  params: {
    datasourceUploadId?: string;
    datasourceFilePath?: string;
    name: string;
    projectId: string;
    overwrite?: boolean;
  },
  options: {
    boundedProjectIds?: Set<string> | null;
    blobStorageEnabled?: boolean;
    transport?: 'stdio' | 'http';
    extraOverrides?: Parameters<typeof getMockRequestHandlerExtra>[0];
  } = {},
): Promise<CallToolResult> {
  if (options.blobStorageEnabled !== undefined) {
    mocks.mockIsBlobStorageEnabled.mockReturnValue(options.blobStorageEnabled);
  }
  const tool = getPublishDatasourceTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      datasourceUploadId: params.datasourceUploadId,
      datasourceFilePath: params.datasourceFilePath,
      name: params.name,
      projectId: params.projectId,
      overwrite: params.overwrite ?? false,
    },
    getMockExtra(options),
  );
}

function getMockExtra({
  boundedProjectIds = null,
  transport = 'stdio',
  extraOverrides = {},
}: {
  boundedProjectIds?: Set<string> | null;
  transport?: 'stdio' | 'http';
  extraOverrides?: Parameters<typeof getMockRequestHandlerExtra>[0];
} = {}): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra(extraOverrides);
  return {
    ...extra,
    getConfigWithOverrides: vi.fn().mockResolvedValue({
      boundedContext: {
        projectIds: boundedProjectIds,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    }),
    config: {
      ...extra.config,
      transport,
    },
  };
}
