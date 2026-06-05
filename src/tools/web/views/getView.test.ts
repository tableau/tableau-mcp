import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetViewTool } from './getView.js';
import { mockView } from './mockView.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getViewTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const getViewTool = getGetViewTool(new WebMcpServer());
    expect(getViewTool.name).toBe('get-view');
    expect(getViewTool.description).toContain('Retrieves information about the specified view');
    expect(getViewTool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
  });

  it('should successfully fetch view metadata without enrichment when Metadata API is disabled', async () => {
    const viewWithUsage = {
      ...mockView,
      usage: {
        totalViewCount: 42,
      },
    };

    mocks.mockGetView.mockResolvedValue(viewWithUsage);

    const result = await getToolResult(
      { viewId: mockView.id },
      {
        disableMetadataApiRequests: true,
      },
    );

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const content = JSON.parse(result.content[0].text);
    expect(content.id).toBe(mockView.id);
    expect(content.name).toBe(mockView.name);
    expect(content.totalViewCount).toBe(42);
    expect(content.usage).toBeUndefined();
    expect(content.upstreamDatasources).toBeUndefined();
    expect(mocks.mockGetView).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: mockView.id,
      includeUsageStatistics: true,
    });
  });
});

async function getToolResult(
  params: { viewId: string },
  configOverrides?: { disableMetadataApiRequests?: boolean },
): Promise<CallToolResult> {
  const getViewTool = getGetViewTool(new WebMcpServer());
  const callback = await Provider.from(getViewTool.callback);
  const mockExtra = getMockRequestHandlerExtra();

  if (configOverrides) {
    mockExtra.getConfigWithOverrides = vi.fn().mockResolvedValue({
      disableMetadataApiRequests: configOverrides.disableMetadataApiRequests ?? false,
      boundedContext: {
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    });
  }

  return await callback(params, mockExtra);
}
