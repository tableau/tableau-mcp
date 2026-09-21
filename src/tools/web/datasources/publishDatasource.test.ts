import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getPublishDatasourceTool } from './publishDatasource.js';

const mocks = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockPublishDatasource: vi.fn(),
  mockUploadFileInChunks: vi.fn(),
  mockResolveStagedDatasourceUpload: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.mockReadFile,
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
    expect(tool.description).toContain('specified Tableau project');
  });

  it('is enabled when the authoring-tools flag is ON for a non-Slack client', async () => {
    const tool = getPublishDatasourceTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('is disabled when the authoring-tools flag is ON for Slack', async () => {
    const tool = getPublishDatasourceTool(
      new WebMcpServer({ clientId: 'https://mcp.slack.com/connector' }),
    );

    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is disabled when the authoring-tools feature flag is OFF even for a non-Slack client', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getPublishDatasourceTool(new WebMcpServer({ clientId: 'https://claude.ai/mcp' }));

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
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
      config: expect.objectContaining({ bucket: 'tableau-workbooks' }),
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
      { bucketS3Enabled: false },
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

  it('validates and publishes a local TDS data source file path', async () => {
    const result = await getToolResult(validLocalArgs, { bucketS3Enabled: false });

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

  it('rejects local data source file paths when staged S3 uploads are configured', async () => {
    const result = await getToolResult(validLocalArgs, { bucketS3Enabled: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'datasourceFilePath is only supported when staged S3 uploads are not configured',
    );
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedDatasourceUpload).not.toHaveBeenCalled();
    expect(mocks.mockUploadFileInChunks).not.toHaveBeenCalled();
  });

  it('returns an args-validation error when local data source path is neither tds nor tdsx', async () => {
    const result = await getToolResult(
      {
        ...validLocalArgs,
        datasourceFilePath: '/tmp/source-superstore.xml',
      },
      { bucketS3Enabled: false },
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

    const result = await getToolResult(validLocalArgs, { bucketS3Enabled: false });

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
  options: { boundedProjectIds?: Set<string> | null; bucketS3Enabled?: boolean } = {},
): Promise<CallToolResult> {
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
  bucketS3Enabled = true,
}: {
  boundedProjectIds?: Set<string> | null;
  bucketS3Enabled?: boolean;
} = {}): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
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
      bucketS3: {
        enabled: bucketS3Enabled,
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
        keyPrefix: 'mcp/',
        presignTtlSeconds: 300,
      },
    },
  };
}
