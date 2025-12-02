import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { Server } from '../../server.js';
import { Provider } from '../../utils/provider.js';
import { getCreateWorkbookTool } from './createWorkbook.js';

const mocks = vi.hoisted(() => ({
  mockInitiateFileUpload: vi.fn(),
  mockAppendToFileUpload: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      publishingMethods: {
        initiateFileUpload: mocks.mockInitiateFileUpload,
        appendToFileUpload: mocks.mockAppendToFileUpload,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('node:crypto', () => {
  return { randomUUID: vi.fn(() => '123e4567-e89b-12d3-a456-426614174000') };
});

describe('createWorkbookTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const createWorkbookTool = getCreateWorkbookTool(new Server());
    expect(createWorkbookTool.name).toBe('create-workbook');
    expect(createWorkbookTool.description).toContain(
      'Creates a Tableau workbook by uploading the TWB (workbook) XML string to the Tableau server.',
    );
    expect(createWorkbookTool.paramsSchema).toMatchObject({});
  });

  it('should successfully create a workbook', async () => {
    mocks.mockInitiateFileUpload.mockResolvedValue(Ok({ uploadSessionId: '1234567890' }));
    mocks.mockAppendToFileUpload.mockResolvedValue(
      Ok({
        uploadSessionId: '1234567890',
        fileSize: 100,
      }),
    );

    const result = await getToolResult({ workbookXml: '<workbook></workbook>' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain(
      'https://my-tableau-server.com/vizql/show/t/tc25/authoring/newWorkbook/123e4567-e89b-12d3-a456-426614174000/fromFileUpload/1234567890',
    );
  });

  it('should handle initiate file upload API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockInitiateFileUpload.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ workbookXml: '<workbook></workbook>' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should handle append to file upload API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockInitiateFileUpload.mockResolvedValue(Ok({ uploadSessionId: '1234567890' }));
    mocks.mockAppendToFileUpload.mockResolvedValue(
      Err({ type: 'append-to-file-upload-error', message: errorMessage }),
    );
    const result = await getToolResult({ workbookXml: '<workbook></workbook>' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(params: { workbookXml: string }): Promise<CallToolResult> {
  const createWorkbookTool = getCreateWorkbookTool(new Server());
  const callback = await Provider.from(createWorkbookTool.callback);
  return await callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
