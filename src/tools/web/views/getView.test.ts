import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getViewTool } from './getView.js';
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
    const tool = getViewTool(new WebMcpServer());
    expect(tool.name).toBe('get-view');
    expect(tool.description).toContain('Retrieves information about the specified view');
    expect(tool.paramsSchema).toMatchObject({ viewId: expect.any(Object) });
  });

  it('should successfully get view', async () => {
    mocks.mockGetView.mockResolvedValue(mockView);
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
    expect(content.id).toBe(mockView.id);
    expect(content.name).toBe(mockView.name);
    expect(content.upstreamDatasources).toBeDefined();
    expect(content.upstreamDatasources).toHaveLength(2);
    expect(content.upstreamDatasources[0].luid).toBe('ds-123');
    expect(content.usage.totalViewCount).toBe(42);
  });

  it('should handle API errors gracefully', async () => {
    mocks.mockGetView.mockRejectedValue(new Error('API Error'));

    const result = await getToolResult({ viewId: mockView.id });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('API Error');
  });

  it('should return view not allowed error when view is not allowed', async () => {
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

  it('should successfully fetch view metadata without enrichment when Metadata API is disabled', async () => {
    mocks.mockGetView.mockResolvedValue(mockView);

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
    expect(content.usage.totalViewCount).toBe(42);
    expect(content.upstreamDatasources).toBeUndefined();
    expect(mocks.mockGetView).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      viewId: mockView.id,
      includeUsageStatistics: true,
    });
  });

  it('should return view without lineage when Metadata API fails', async () => {
    mocks.mockGetView.mockResolvedValue(mockView);
    mocks.mockGraphql.mockRejectedValue(new Error('Metadata API unavailable'));

    const result = await getToolResult({ viewId: mockView.id });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const content = JSON.parse(result.content[0].text);
    expect(content.id).toBe(mockView.id);
    expect(content.usage.totalViewCount).toBe(42);
    expect(content.upstreamDatasources).toBeUndefined();
  });

  it('should filter upstream datasources by allowlist', async () => {
    mocks.mockGetView.mockResolvedValue(mockView);
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

  it('should return usage as undefined when not provided by API', async () => {
    mocks.mockResourceAccessChecker.isViewAllowed.mockResolvedValue({
      allowed: true,
    });

    const { usage: _usage, ...viewWithoutUsage } = mockView;

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
      expect(content.usage).toBeUndefined();
    }
  });

  describe('bounded context access control', () => {
    it('should return error when view workbook is not in workbookIds allowlist', async () => {
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

    it('should return error when view project is not in projectIds allowlist', async () => {
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

    it('should return error when view does not have allowed tags', async () => {
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
  const tool = getViewTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
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
