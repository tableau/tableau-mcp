import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateUploadedWorkbookTool } from './validateUploadedWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockValidateUploadedWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        validateUploadedWorkbook: mocks.mockValidateUploadedWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('validateUploadedWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getValidateUploadedWorkbookTool(new WebMcpServer());
    expect(tool.name).toBe('validate-uploaded-workbook');
    expect(tool.description).toContain('Validates a workbook that has been uploaded');
    expect(tool.paramsSchema).toMatchObject({ uploadSessionId: expect.any(Object) });
  });

  it('should return a successful validation result with warnings and no errors', async () => {
    const validation = {
      timestamp: '2026-06-10T14:32:18.456Z',
      uploadId: '12345:abc',
      warnings: [
        {
          severity: 'WARNING',
          message: 'Unknown map source is used',
          line: 245,
          column: 18,
          elementName: 'map',
        },
      ],
    };
    mocks.mockValidateUploadedWorkbook.mockResolvedValue(validation);

    const result = await getToolResult({ uploadSessionId: 'session-42' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const response = JSON.parse(result.content[0].text);
    expect(response.warnings).toEqual(validation.warnings);
    expect(response.errors).toBeUndefined();

    expect(mocks.mockValidateUploadedWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'session-42',
    });
  });

  it('should report validation errors as structured success data (not a tool error)', async () => {
    const validation = {
      timestamp: '2026-06-10T14:32:18.456Z',
      errors: [
        {
          severity: 'ERROR',
          message: 'Missing required closing tag for element',
          line: 1,
          column: 1,
          elementName: 'x',
        },
      ],
      warnings: [],
    };
    mocks.mockValidateUploadedWorkbook.mockResolvedValue(validation);

    const result = await getToolResult({ uploadSessionId: 'session-42' });

    // A 422-style "validation found problems" result is a normal outcome, not a failure.
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const response = JSON.parse(result.content[0].text);
    expect(response.errors).toEqual(validation.errors);
    expect(response.warnings).toEqual([]);

    expect(mocks.mockValidateUploadedWorkbook).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      uploadSessionId: 'session-42',
    });
  });

  it('should surface a genuine request error as a tool error', async () => {
    const errorMessage = 'Request failed with status code 404';
    mocks.mockValidateUploadedWorkbook.mockRejectedValue(new Error(errorMessage));

    const result = await getToolResult({ uploadSessionId: 'unknown-session' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { uploadSessionId: string }): Promise<CallToolResult> {
  const tool = getValidateUploadedWorkbookTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}
