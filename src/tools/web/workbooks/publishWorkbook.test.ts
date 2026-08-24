import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from './mockWorkbook.js';
import { getPublishWorkbookTool } from './publishWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockPublishWorkbook: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        publishWorkbook: mocks.mockPublishWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

const validArgs = {
  uploadSessionId: 'upload-session-id',
  workbookType: 'twb' as const,
  name: 'My New Workbook',
  projectId: 'target-project-id',
};

describe('publishWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    RestApi.version = '3.29';
    mocks.mockPublishWorkbook.mockReset();
    mocks.mockIsFeatureEnabled.mockReset();
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...mockWorkbook,
      project: { id: 'target-project-id', name: 'Marketing Analytics' },
    });
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('publish-workbook');
    expect(paramsSchema).toMatchObject({
      uploadSessionId: expect.any(Object),
      workbookType: expect.any(Object),
      name: expect.any(Object),
      projectId: expect.any(Object),
      overwrite: expect.any(Object),
    });
    expect(annotations.destructiveHint).toBe(true);
    expect(paramsSchema.name.safeParse('').success).toBe(false);
  });

  it('is disabled when the authoring-tools feature flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getPublishWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled when the authoring-tools feature flag is ON', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('publishes to the requested project using the given uploadSessionId and workbookType', async () => {
    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.status).toBe('published');
    expect(response.data.id).toBe(mockWorkbook.id);
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'upload-session-id',
      name: 'My New Workbook',
      workbookType: 'twb',
      projectId: 'target-project-id',
      overwrite: false,
    });
  });

  it('publishes a twbx uploadSessionId with workbookType twbx passed through unchanged', async () => {
    await getToolResult({ ...validArgs, workbookType: 'twbx' });

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ workbookType: 'twbx' }),
    );
  });

  it('defaults overwrite to false when publishing', async () => {
    await getToolResult(validArgs);

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: false }),
    );
  });

  it('returns an error without overwriting when Tableau rejects a duplicate workbook name', async () => {
    mocks.mockPublishWorkbook.mockRejectedValue(
      new Error('A workbook named My New Workbook already exists in the target project.'),
    );

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('already exists in the target project');
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My New Workbook', overwrite: false }),
    );
  });

  it('passes overwrite true through when publishing', async () => {
    await getToolResult({ ...validArgs, overwrite: true });

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );
  });

  it('returns an error when the requested project is outside bounded context', async () => {
    const result = await getToolResult(validArgs, {
      boundedProjectIds: new Set(['different-project-id']),
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not allowed by this MCP server');
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
    expect(mocks.mockPublishWorkbook).not.toHaveBeenCalled();
  });

  it('redacts uploadSessionId details passed to shared logging', async () => {
    const tool = getPublishWorkbookTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(
      {
        uploadSessionId: 'upload-session-id',
        workbookType: 'twb',
        name: validArgs.name,
        projectId: validArgs.projectId,
        overwrite: false,
      },
      getMockRequestHandlerExtra(),
    );

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      uploadSessionId: '<redacted>',
      workbookType: 'twb',
      name: validArgs.name,
      projectId: validArgs.projectId,
      overwrite: false,
    });
    expect(JSON.stringify(loggedArgs)).not.toContain('upload-session-id');
  });
});

async function getToolResult(
  params: {
    uploadSessionId: string;
    workbookType: 'twb' | 'twbx';
    name: string;
    projectId: string;
    overwrite?: boolean;
  },
  options: { boundedProjectIds?: Set<string> | null } = {},
): Promise<CallToolResult> {
  const tool = getPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      uploadSessionId: params.uploadSessionId,
      workbookType: params.workbookType,
      name: params.name,
      projectId: params.projectId,
      overwrite: params.overwrite ?? false,
    },
    getMockExtra(options),
  );
}

function getMockExtra({
  boundedProjectIds = null,
}: { boundedProjectIds?: Set<string> | null } = {}): ReturnType<
  typeof getMockRequestHandlerExtra
> {
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
  };
}
