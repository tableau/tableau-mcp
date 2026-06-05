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
  mockGraphql: vi.fn(),
  mockResourceAccessChecker: {
    isViewAllowed: vi.fn(),
  },
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
      },
      metadataMethods: {
        graphql: mocks.mockGraphql,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: mocks.mockResourceAccessChecker,
  exportedForTesting: {
    resetResourceAccessCheckerSingleton: vi.fn(),
  },
}));

describe('getViewTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({ allowed: true });
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
    });
  });

  it('returns error when view is not in viewIds allowlist', async () => {
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: false,
      message: 'Querying the view with LUID test-view-id is not allowed.',
    });

    const result = await getToolResult({ viewId: 'test-view-id' });

    expect(result.isError).toBe(true);
    if (result.isError) {
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Querying the view with LUID test-view-id is not allowed',
      );
    }
  });

  it('returns error when view workbook is not in workbookIds allowlist', async () => {
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: false,
      message:
        'The view with LUID test-view-id cannot be queried because it does not belong to an allowed workbook.',
    });

    const result = await getToolResult({ viewId: 'test-view-id' });

    expect(result.isError).toBe(true);
    if (result.isError) {
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('does not belong to an allowed workbook');
    }
  });

  it('returns error when view project is not in projectIds allowlist', async () => {
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: false,
      message:
        'The view with LUID test-view-id cannot be queried because it does not belong to an allowed project.',
    });

    const result = await getToolResult({ viewId: 'test-view-id' });

    expect(result.isError).toBe(true);
    if (result.isError) {
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('does not belong to an allowed project');
    }
  });

  it('returns error when view does not have allowed tags', async () => {
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: false,
      message:
        'The view with LUID test-view-id cannot be queried because it does not have one of the allowed tags.',
    });

    const result = await getToolResult({ viewId: 'test-view-id' });

    expect(result.isError).toBe(true);
    if (result.isError) {
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('does not have one of the allowed tags');
    }
  });

  it('successfully enriches view with lineage data', async () => {
    const viewWithUsage = {
      ...mockView,
      usage: {
        totalViewCount: 100,
      },
    };

    mocks.mockGetView.mockResolvedValue(viewWithUsage);
    mocks.mockGraphql.mockResolvedValue({
      data: {
        sheetsConnection: {
          nodes: [
            {
              luid: mockView.id,
              upstreamDatasources: [
                { luid: 'ds-123', name: 'Sales Data' },
                { luid: 'ds-456', name: 'Customer Data' },
              ],
            },
          ],
        },
      },
    });

    const result = await getToolResult({ viewId: mockView.id });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const content = JSON.parse(result.content[0].text);
    expect(content.upstreamDatasources).toBeDefined();
    expect(content.upstreamDatasources).toHaveLength(2);
    expect(content.upstreamDatasources[0].luid).toBe('ds-123');
    expect(content.totalViewCount).toBe(100);
  });

  it('returns view without lineage when Metadata API fails', async () => {
    const viewWithUsage = {
      ...mockView,
      usage: {
        totalViewCount: 50,
      },
    };

    mocks.mockGetView.mockResolvedValue(viewWithUsage);
    mocks.mockGraphql.mockRejectedValue(new Error('Metadata API unavailable'));

    const result = await getToolResult({ viewId: mockView.id });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const content = JSON.parse(result.content[0].text);
    expect(content.id).toBe(mockView.id);
    expect(content.totalViewCount).toBe(50);
    expect(content.upstreamDatasources).toBeUndefined();
  });

  it('filters upstream datasources by allowlist', async () => {
    const viewWithUsage = {
      ...mockView,
      usage: {
        totalViewCount: 75,
      },
    };

    mocks.mockGetView.mockResolvedValue(viewWithUsage);
    mocks.mockGraphql.mockResolvedValue({
      data: {
        sheetsConnection: {
          nodes: [
            {
              luid: mockView.id,
              upstreamDatasources: [
                { luid: 'ds-allowed', name: 'Allowed DS' },
                { luid: 'ds-blocked', name: 'Blocked DS' },
              ],
            },
          ],
        },
      },
    });

    const result = await getToolResult(
      { viewId: mockView.id },
      {
        disableMetadataApiRequests: false,
        boundedContextOverrides: {
          datasourceIds: new Set(['ds-allowed']),
        },
      },
    );

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const content = JSON.parse(result.content[0].text);
    expect(content.upstreamDatasources).toBeDefined();
    expect(content.upstreamDatasources).toHaveLength(1);
    expect(content.upstreamDatasources[0].luid).toBe('ds-allowed');
  });

  it('flattens usage stats with zero count when usage is undefined', async () => {
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: true,
    });

    const viewWithoutUsage: typeof mockView = {
      ...mockView,
    };

    mocks.mockGetView.mockResolvedValue(viewWithoutUsage);

    const result = await getToolResult(
      { viewId: mockView.id },
      {
        disableMetadataApiRequests: true,
      },
    );

    expect(result.isError).toBe(false);
    if (!result.isError) {
      invariant(result.content[0].type === 'text');
      const content = JSON.parse(result.content[0].text);
      expect(content.totalViewCount).toBe(0);
      expect(content.usage).toBeUndefined();
    }
  });
});

async function getToolResult(
  params: { viewId: string },
  configOverrides?: {
    disableMetadataApiRequests?: boolean;
    boundedContextOverrides?: {
      datasourceIds?: Set<string>;
    };
  },
): Promise<CallToolResult> {
  const getViewTool = getGetViewTool(new WebMcpServer());
  const callback = await Provider.from(getViewTool.callback);
  const mockExtra = getMockRequestHandlerExtra();

  if (configOverrides) {
    mockExtra.getConfigWithOverrides = vi.fn().mockResolvedValue({
      disableMetadataApiRequests: configOverrides.disableMetadataApiRequests ?? false,
      boundedContext: {
        projectIds: null,
        datasourceIds: configOverrides.boundedContextOverrides?.datasourceIds ?? null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      },
    });
  }

  return await callback(params, mockExtra);
}
