import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from './mockWorkbook.js';
import { getValidateUploadAndPublishWorkbookTool } from './validateUploadAndPublishWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockPublishWorkbook: vi.fn(),
  mockQueryProjects: vi.fn(),
  mockValidateWorkbookAndUpload: vi.fn(),
  mockResolveStagedWorkbookUpload: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.mockReadFile,
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        validateWorkbookAndUpload: mocks.mockValidateWorkbookAndUpload,
        publishWorkbook: mocks.mockPublishWorkbook,
      },
      projectsMethods: {
        queryProjects: mocks.mockQueryProjects,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('./stagedWorkbookUpload.js', () => ({
  resolveStagedWorkbookUpload: mocks.mockResolveStagedWorkbookUpload,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

const validArgs = {
  workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
  name: 'My New Workbook',
};

const validLocalArgs = {
  workbookFilePath: '/tmp/source-superstore.twb',
  name: 'My New Workbook',
};

describe('validateUploadAndPublishWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    RestApi.version = '3.29';
    mocks.mockPublishWorkbook.mockReset();
    mocks.mockQueryProjects.mockReset();
    mocks.mockValidateWorkbookAndUpload.mockReset();
    mocks.mockResolveStagedWorkbookUpload.mockReset();
    mocks.mockReadFile.mockReset();
    mocks.mockIsFeatureEnabled.mockReset();
    mocks.mockReadFile.mockResolvedValue(Buffer.from('<workbook source="local" />'));
    mocks.mockResolveStagedWorkbookUpload.mockResolvedValue({
      fileName: 'source-superstore.twb',
      bytes: Buffer.from('<workbook source="new" />'),
    });
    mocks.mockQueryProjects.mockResolvedValue({
      projects: [
        { id: 'nested-default-project-id', name: 'Default', parentProjectId: 'parent-id' },
        { id: 'default-project-id', name: 'Default' },
      ],
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'default-project-id', name: 'Default' },
    });
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());
    expect(tool.name).toBe('validate-upload-and-publish-workbook');
    expect(tool.description).toContain('Validates a TWB workbook');
    expect(tool.paramsSchema).toMatchObject({
      workbookUploadId: expect.any(Object),
      workbookFilePath: expect.any(Object),
      name: expect.any(Object),
      overwrite: expect.any(Object),
    });
    expect(tool.description).toContain('site Default project');
  });

  it('is disabled when the authoring-tools feature flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('is enabled when the authoring-tools feature flag is ON', async () => {
    const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('authoring-tools');
  });

  it('validates, publishes to the top-level Default project, and returns the published workbook', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
      warnings: [
        {
          severity: 'WARNING',
          message: 'Unknown map source is used',
          line: 245,
          column: 18,
          elementName: 'map',
        },
      ],
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'default-project-id', name: 'Default' },
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.data.id).toBe(mockWorkbook.id);
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );
    expect(response.warnings).toEqual([
      {
        severity: 'WARNING',
        message: 'Unknown map source is used',
        line: 245,
        column: 18,
        elementName: 'map',
      },
    ]);

    expect(mocks.mockValidateWorkbookAndUpload).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twb',
      workbook: Buffer.from('<workbook source="new" />'),
    });
    expect(mocks.mockResolveStagedWorkbookUpload).toHaveBeenCalledWith({
      workbookUploadId: validArgs.workbookUploadId,
      config: expect.objectContaining({ bucket: 'tableau-workbooks' }),
    });
    expect(mocks.mockQueryProjects).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Default',
      pageSize: 100,
      pageNumber: 1,
    });
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'validated-upload-id',
      name: 'My New Workbook',
      workbookType: 'twb',
      projectId: 'default-project-id',
      overwrite: false,
    });
  });

  it('defaults overwrite to false when publishing', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'default-project-id', name: 'Default' },
    });

    await getToolResult(validArgs);

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: false }),
    );
  });

  it('passes overwrite true through when publishing', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'default-project-id', name: 'Default' },
    });

    await getToolResult({ ...validArgs, overwrite: true });

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );
  });

  it('resolves the staged workbookUploadId before validation', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'default-project-id', name: 'Default' },
    });
    const workbookUploadId = '123e4567-e89b-42d3-a456-426614174000';

    await getToolResult({ workbookUploadId, name: 'My New Workbook' });

    expect(mocks.mockResolveStagedWorkbookUpload).toHaveBeenCalledWith({
      workbookUploadId,
      config: expect.objectContaining({ bucket: 'tableau-workbooks' }),
    });
    expect(mocks.mockValidateWorkbookAndUpload).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twb',
      workbook: Buffer.from('<workbook source="new" />'),
    });
  });

  it('validates and publishes a local workbook file path', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'default-project-id', name: 'Default' },
    });

    const result = await getToolResult(validLocalArgs);

    expect(result.isError).toBe(false);
    expect(mocks.mockReadFile).toHaveBeenCalledWith('/tmp/source-superstore.twb');
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filename: 'source-superstore.twb',
      workbook: Buffer.from('<workbook source="local" />'),
    });
  });

  it('returns an error when both local path and staged upload id are provided', async () => {
    const result = await getToolResult({
      ...validLocalArgs,
      workbookUploadId: validArgs.workbookUploadId,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Provide either workbookFilePath or workbookUploadId, not both',
    );
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('returns an error when neither local path nor staged upload id is provided', async () => {
    const result = await getToolResult({ name: validArgs.name });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Either workbookFilePath or workbookUploadId');
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
  });

  it('returns validation errors and does not publish when the workbook is invalid', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      errors: [
        {
          severity: 'ERROR',
          message: 'Missing required closing tag for element',
          line: 127,
          column: 5,
          elementName: 'preferences',
        },
      ],
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response).toEqual({
      status: 'invalid',
      errors: [
        {
          severity: 'ERROR',
          message: 'Missing required closing tag for element',
          line: 127,
          column: 5,
          elementName: 'preferences',
        },
      ],
      warnings: [],
    });
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('falls back to a lowercase top-level default project', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockQueryProjects.mockResolvedValue({
      projects: [
        { id: 'nested-default-project-id', name: 'Default', parentProjectId: 'parent-id' },
        { id: 'lowercase-default-project-id', name: 'default' },
      ],
    });

    await getToolResult(validArgs);

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'lowercase-default-project-id',
      }),
    );
  });

  it('returns an error and does not publish when Tableau does not return an upload id', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not return an uploadId');
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('returns a clear compatibility error on REST API versions before 3.29', async () => {
    const originalVersionIsAtLeast = RestApi.versionIsAtLeast;
    RestApi.version = '3.28';
    RestApi.versionIsAtLeast = vi.fn().mockReturnValue(false);

    const result = await getToolResult(validArgs).finally(() => {
      RestApi.versionIsAtLeast = originalVersionIsAtLeast;
      RestApi.version = '3.29';
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires Tableau REST API version 3.29 or later');
    expect(result.content[0].text).toContain('REST API version 3.28');
    expect(mocks.mockResolveStagedWorkbookUpload).not.toHaveBeenCalled();
    expect(mocks.mockValidateWorkbookAndUpload).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('returns an error and does not publish when the top-level Default project cannot be found', async () => {
    mocks.mockValidateWorkbookAndUpload.mockResolvedValue({
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: 'validated-upload-id',
    });
    mocks.mockQueryProjects.mockResolvedValue({
      projects: [
        { id: 'nested-default-project-id', name: 'Default', parentProjectId: 'parent-id' },
      ],
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Could not find the site Default project');
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('redacts staged workbookUploadId details passed to shared logging', async () => {
    const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
        workbookFilePath: undefined,
        name: validArgs.name,
        overwrite: false,
      },
      getMockRequestHandlerExtra(),
    );

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      workbookUploadId: '<redacted>',
      workbookFilePath: undefined,
      name: validArgs.name,
      overwrite: false,
    });
    expect(JSON.stringify(loggedArgs)).not.toContain('123e4567-e89b-42d3-a456-426614174000');
  });
});

async function getToolResult(params: {
  workbookUploadId?: string;
  workbookFilePath?: string;
  name: string;
  overwrite?: boolean;
}): Promise<CallToolResult> {
  const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      workbookUploadId: params.workbookUploadId,
      workbookFilePath: params.workbookFilePath,
      name: params.name,
      overwrite: params.overwrite ?? false,
    },
    getMockExtra(),
  );
}

function getMockExtra(): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
  return {
    ...extra,
    config: {
      ...extra.config,
      bucketS3: {
        enabled: true,
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
        keyPrefix: 'mcp/',
        presignTtlSeconds: 300,
      },
    },
  };
}
