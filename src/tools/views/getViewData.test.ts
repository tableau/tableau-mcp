import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getGetViewDataTool as getGetViewDataTool } from './getViewData.js';
import { mockView } from './mockView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mockViewData =
  '"Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)\nCanada,Alberta,19.5%,53.41,-114.42\n"';

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
  mockQueryViewData: vi.fn(),
  mockGetConfig: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
        queryViewData: mocks.mockQueryViewData,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../config.js', () => ({
  getConfig: mocks.mockGetConfig,
}));

describe('getViewDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetResourceAccessCheckerSingleton();
    mocks.mockGetConfig.mockReturnValue({
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
      },
    });
  });

  it('should create a tool instance with correct properties', () => {
    const getViewDataTool = getGetViewDataTool(new Server());
    expect(getViewDataTool.name).toBe('get-view-data');
    expect(getViewDataTool.description).toContain(
      'Retrieves data in comma separated value (CSV) format for the specified view in a Tableau workbook.',
    );
    expect(getViewDataTool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
  });

  it('should successfully get view data', async () => {
    mocks.mockQueryViewData.mockResolvedValue(mockViewData);
    const result = await getToolResult({ viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain(
      'Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)',
    );
    expect(result.content[0].text).toContain('Canada,Alberta,19.5%,53.41,-114.42');
    expect(mocks.mockQueryViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d',
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryViewData.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ viewId: '4d18c547-bbb1-4187-ae5a-7f78b35adf2d' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return view not allowed error when view is not allowed', async () => {
    mocks.mockGetConfig.mockReturnValue({
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: new Set(['some-other-workbook-id']),
      },
    });
    mocks.mockGetView.mockResolvedValue(mockView);

    const result = await getToolResult({ viewId: mockView.id });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      [
        'The set of allowed workbooks that can be queried is limited by the server configuration.',
        'The view with LUID 4d18c547-bbb1-4187-ae5a-7f78b35adf2d cannot be queried because it does not belong to an allowed workbook.',
      ].join(' '),
    );

    expect(mocks.mockQueryViewData).not.toHaveBeenCalled();
  });
});

async function getToolResult(params: { viewId: string }): Promise<CallToolResult> {
  const getViewDataTool = getGetViewDataTool(new Server());
  return await getViewDataTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
