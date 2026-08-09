import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockWorkbook } from './mockWorkbook.js';
import { getPublishWorkbookTool } from './publishWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockPublishWorkbook: vi.fn(),
  mockValidateUploadedWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        publishWorkbook: mocks.mockPublishWorkbook,
        validateUploadedWorkbook: mocks.mockValidateUploadedWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

const validArgs = {
  uploadSessionId: 'upload-session-123',
  name: 'My New Workbook',
  projectId: 'ae5e9374-2a58-40ab-93e4-a2fd1b07cf7d',
};

describe('publishWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const publishWorkbookTool = getPublishWorkbookTool(new WebMcpServer());
    expect(publishWorkbookTool.name).toBe('publish-workbook');
    expect(publishWorkbookTool.description).toContain('Publishes a workbook');
    expect(publishWorkbookTool.paramsSchema).toMatchObject({
      uploadSessionId: expect.any(Object),
      name: expect.any(Object),
      projectId: expect.any(Object),
      overwrite: expect.any(Object),
    });
  });

  it('should state in its description that it does not validate the workbook', () => {
    const publishWorkbookTool = getPublishWorkbookTool(new WebMcpServer());
    expect(publishWorkbookTool.description).toContain('does NOT validate');
    expect(publishWorkbookTool.description).toContain('validate-uploaded-workbook');
  });

  it('should be annotated as a non-read-only, non-destructive create operation', () => {
    const publishWorkbookTool = getPublishWorkbookTool(new WebMcpServer());
    expect(publishWorkbookTool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('should successfully publish a workbook and return its data and url', async () => {
    mocks.mockPublishWorkbook.mockResolvedValue(mockWorkbook);

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const response = JSON.parse(result.content[0].text);
    expect(response.data).toBeDefined();
    expect(response.data.id).toBe(mockWorkbook.id);
    expect(response.data.name).toBe('Superstore');
    expect(response.url).toBe(
      'https://my-tableau-server.com/#/site/tc25/views/Superstore/Overview',
    );

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'upload-session-123',
      workbookType: 'twb',
      name: 'My New Workbook',
      projectId: 'ae5e9374-2a58-40ab-93e4-a2fd1b07cf7d',
      overwrite: undefined,
    });
  });

  it('should pass overwrite through to the SDK when provided', async () => {
    mocks.mockPublishWorkbook.mockResolvedValue(mockWorkbook);

    await getToolResult({ ...validArgs, overwrite: true });

    expect(mocks.mockPublishWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );
  });

  it('should fall back to webpageUrl when the workbook has no views', async () => {
    const { views: _views, ...workbookWithoutViews } = mockWorkbook;
    mocks.mockPublishWorkbook.mockResolvedValue({
      ...workbookWithoutViews,
      webpageUrl: 'https://my-tableau-server.com/#/workbooks/123/views',
    });

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.url).toBe('https://my-tableau-server.com/#/workbooks/123/views');
  });

  it('should NOT validate the uploaded workbook before publishing', async () => {
    mocks.mockPublishWorkbook.mockResolvedValue(mockWorkbook);

    await getToolResult(validArgs);

    // The "we're not validating" design decision: publishing must never call the validation
    // endpoint. This is a regression guard for that explicit choice.
    expect(mocks.mockValidateUploadedWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockPublishWorkbook).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockPublishWorkbook.mockRejectedValue(new Error(errorMessage));

    const result = await getToolResult(validArgs);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: {
  uploadSessionId: string;
  name: string;
  projectId: string;
  overwrite?: boolean;
}): Promise<CallToolResult> {
  const publishWorkbookTool = getPublishWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(publishWorkbookTool.callback);
  return await callback(
    {
      uploadSessionId: params.uploadSessionId,
      name: params.name,
      projectId: params.projectId,
      overwrite: params.overwrite,
    },
    getMockRequestHandlerExtra(),
  );
}
