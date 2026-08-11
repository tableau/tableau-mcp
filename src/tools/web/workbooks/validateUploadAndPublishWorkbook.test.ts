import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from './mockWorkbook.js';
import { getValidateUploadAndPublishWorkbookTool } from './validateUploadAndPublishWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockPublishWorkbook: vi.fn(),
  mockQueryProjects: vi.fn(),
  mockValidateWorkbookAndUpload: vi.fn(),
  mockResolveLocalWorkbook: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
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

vi.mock('./localWorkbookFile.js', () => ({
  resolveLocalWorkbook: mocks.mockResolveLocalWorkbook,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

const validArgs = {
  workbookFilePath: '/tmp/superstore.twb',
  name: 'My New Workbook',
};

describe('validateUploadAndPublishWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockResolveLocalWorkbook.mockResolvedValue({
      fileName: 'superstore.twb',
      bytes: Buffer.from('<workbook />'),
    });
    mocks.mockQueryProjects.mockResolvedValue({
      projects: [
        { id: 'nested-default-project-id', name: 'Default', parentProjectId: 'parent-id' },
        { id: 'default-project-id', name: 'Default' },
      ],
    });
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());
    expect(tool.name).toBe('validate-upload-and-publish-workbook');
    expect(tool.description).toContain('Validates a local TWB workbook');
    expect(tool.paramsSchema).toMatchObject({
      workbookFilePath: expect.any(Object),
      name: expect.any(Object),
      overwrite: expect.any(Object),
    });
    expect(tool.description).toContain('site Default project');
  });

  it('is disabled when the upload-validate-publish feature flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(true);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('upload-validate-publish');
  });

  it('is enabled when the upload-validate-publish feature flag is ON', async () => {
    const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());

    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('upload-validate-publish');
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
      filename: 'superstore.twb',
      workbook: Buffer.from('<workbook />'),
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
      overwrite: undefined,
    });
  });

  it('passes overwrite through when publishing', async () => {
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

  it('redacts the local workbook path passed to shared logging', async () => {
    const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const logAndExecute = vi
      .spyOn(tool, 'logAndExecute')
      .mockResolvedValue({ isError: false, content: [] } as CallToolResult);

    await callback(validArgs, getMockRequestHandlerExtra());

    const loggedArgs = logAndExecute.mock.calls[0][0].args;
    expect(loggedArgs).toEqual({
      workbookFilePath: '<redacted>',
      name: validArgs.name,
      overwrite: undefined,
    });
    expect(JSON.stringify(loggedArgs)).not.toContain(validArgs.workbookFilePath);
  });
});

async function getToolResult(params: {
  workbookFilePath: string;
  name: string;
  overwrite?: boolean;
}): Promise<CallToolResult> {
  const tool = getValidateUploadAndPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      workbookFilePath: params.workbookFilePath,
      name: params.name,
      overwrite: params.overwrite,
    },
    getMockRequestHandlerExtra(),
  );
}
