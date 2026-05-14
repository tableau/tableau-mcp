import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetCustomViewDataTool } from './getCustomViewData.js';
import { mockCustomView } from './mockCustomView.js';
import { mockView } from './mockView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mockCsv = '"Country/Region,State/Province,Profit Ratio\nCanada,Alberta,19.5%\n"';

const mocks = vi.hoisted(() => ({
  mockGetCustomView: vi.fn(),
  mockGetView: vi.fn(),
  mockGetCustomViewData: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getCustomView: mocks.mockGetCustomView,
        getView: mocks.mockGetView,
        getCustomViewData: mocks.mockGetCustomViewData,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getCustomViewDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockGetCustomView.mockResolvedValue(mockCustomView);
    mocks.mockGetView.mockResolvedValue(mockView);
    mocks.mockGetCustomViewData.mockResolvedValue(mockCsv);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getGetCustomViewDataTool(new WebMcpServer());
    expect(tool.name).toBe('get-custom-view-data');
    expect(tool.description).toContain('custom view');
    expect(tool.paramsSchema).toMatchObject({
      customViewId: expect.any(Object),
      viewFilters: expect.any(Object),
    });
  });

  it('should successfully get custom view data', async () => {
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Country/Region');
    expect(mocks.mockGetCustomViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      viewFilters: undefined,
    });
  });

  it('should pass viewFilters to the REST layer', async () => {
    await getToolResult({ customViewId: mockCustomView.id, viewFilters: { Year: '2024' } });
    expect(mocks.mockGetCustomViewData).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      customViewId: mockCustomView.id,
      viewFilters: { Year: '2024' },
    });
  });

  it('should handle API errors when fetching data', async () => {
    const errorMessage = 'API Error';
    mocks.mockGetCustomViewData.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return not allowed when underlying view fails bounded context', async () => {
    vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-id');
    const result = await getToolResult({ customViewId: mockCustomView.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('does not belong to an allowed workbook');
    expect(mocks.mockGetCustomViewData).not.toHaveBeenCalled();
  });
});

async function getToolResult({
  customViewId,
  viewFilters,
}: {
  customViewId: string;
  viewFilters?: Record<string, string>;
}): Promise<CallToolResult> {
  const tool = getGetCustomViewDataTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      customViewId,
      viewFilters,
    },
    getMockRequestHandlerExtra(),
  );
}
