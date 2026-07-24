import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { getCombinationsOfBoundedContextInputs } from '../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { constrainDatasources, getListDatasourcesTool } from './listDatasources.js';
import { mockDatasources } from './mockDatasources.js';

const mocks = vi.hoisted(() => ({
  mockListDatasources: vi.fn(),
  mockIsDatasourceAllowed: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      datasourcesMethods: {
        listDatasources: mocks.mockListDatasources,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isDatasourceAllowed: mocks.mockIsDatasourceAllowed,
  },
}));

describe('listDatasourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
  });

  it('should create a tool instance with correct properties', () => {
    const listDatasourcesTool = getListDatasourcesTool(new WebMcpServer());
    expect(listDatasourcesTool.name).toBe('list-datasources');
    expect(listDatasourcesTool.description).toContain('Retrieves a list of published data sources');
    expect(listDatasourcesTool.paramsSchema).toMatchObject({ filter: expect.any(Object) });
  });

  it('should successfully list datasources', async () => {
    mocks.mockListDatasources.mockResolvedValue(mockDatasources);
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Superstore');
    expect(mocks.mockListDatasources).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListDatasources.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should resolve a datasource by exact contentUrl using optional resolver mode', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      ...mockDatasources,
      datasources: [
        { ...mockDatasources.datasources[0], id: 'wrong-case', contentUrl: 'gus-work' },
        { ...mockDatasources.datasources[0], id: 'exact-case', contentUrl: 'GUS-Work' },
      ],
    });

    const result = await getToolResult({ resolveContentUrl: 'GUS-Work' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('exact-case');
    expect(mocks.mockListDatasources).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'contentUrl:eq:GUS-Work',
      pageSize: 100,
      pageNumber: 1,
    });
    expect(mocks.mockIsDatasourceAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceLuid: 'exact-case' }),
    );
  });

  it('should return identical no-match error for denied resolver hits (no existence oracle)', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      ...mockDatasources,
      datasources: [{ ...mockDatasources.datasources[0], id: 'denied', contentUrl: 'GUS-Work' }],
    });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: false, message: 'denied' });
    const denied = await getToolResult({ resolveContentUrl: 'GUS-Work' });

    mocks.mockListDatasources.mockResolvedValue({ ...mockDatasources, datasources: [] });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
    const absent = await getToolResult({ resolveContentUrl: 'GUS-Work' });

    expect(denied.isError).toBe(true);
    expect(absent.isError).toBe(true);
    invariant(denied.content[0].type === 'text');
    invariant(absent.content[0].type === 'text');
    expect(denied.content[0].text).toContain('No datasource matched contentUrl');
    expect(denied.content[0].text).toBe(absent.content[0].text);
  });

  it('should return no-match when multiple exact candidates are all denied (no existence oracle)', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      ...mockDatasources,
      datasources: [
        { ...mockDatasources.datasources[0], id: 'd1', contentUrl: 'GUS-Work' },
        { ...mockDatasources.datasources[0], id: 'd2', contentUrl: 'GUS-Work' },
      ],
    });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: false, message: 'denied' });

    const result = await getToolResult({ resolveContentUrl: 'GUS-Work' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No datasource matched contentUrl');
  });

  it('should return the single allowed candidate when exact set includes denied items', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      ...mockDatasources,
      datasources: [
        { ...mockDatasources.datasources[0], id: 'denied', contentUrl: 'GUS-Work' },
        { ...mockDatasources.datasources[0], id: 'allowed', contentUrl: 'GUS-Work' },
      ],
    });
    mocks.mockIsDatasourceAllowed.mockImplementation(async ({ datasourceLuid }) => ({
      allowed: datasourceLuid === 'allowed',
      message: 'denied',
    }));

    const result = await getToolResult({ resolveContentUrl: 'GUS-Work' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('allowed');
  });

  it('should return ambiguous error when multiple allowed candidates remain', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      ...mockDatasources,
      datasources: [
        { ...mockDatasources.datasources[0], id: 'a1', contentUrl: 'GUS-Work' },
        { ...mockDatasources.datasources[0], id: 'a2', contentUrl: 'GUS-Work' },
      ],
    });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });

    const result = await getToolResult({ resolveContentUrl: 'GUS-Work' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Multiple datasources matched contentUrl');
  });

  it('should reject requests that pass filter and resolveContentUrl together', async () => {
    const result = await getToolResult({
      filter: 'name:eq:Superstore',
      resolveContentUrl: 'GUS-Work',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pass either "filter" or "resolveContentUrl"');
  });

  it('should reject pagination arguments in resolver mode', async () => {
    const result = await getToolResult({
      resolveContentUrl: 'GUS-Work',
      pageSize: 25,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Resolver mode does not accept "pageSize" or "limit"');
  });

  it('should reject resolver mode when INSIGHTS_TOOLS_ENABLED is false', async () => {
    const result = await getToolResult({
      resolveContentUrl: 'GUS-Work',
      insightsToolsEnabled: false,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Resolver mode is disabled');
  });

  it('should reject resolver contentUrl values that break filter grammar', async () => {
    const result = await getToolResult({ resolveContentUrl: 'Sales,Ops' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Invalid filter expression format');
  });

  describe('constrainDatasources', () => {
    it('should return empty result when no datasources are found', () => {
      const result = constrainDatasources({
        datasources: [],
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No datasources were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all datasources were filtered out by the bounded context', () => {
      const result = constrainDatasources({
        datasources: mockDatasources.datasources,
        boundedContext: {
          projectIds: new Set(['123']),
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed data sources that can be queried is limited by the server configuration.',
          'While data sources were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    test.each(
      getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set([mockDatasources.datasources[0].project.id])],
        datasourceIds: [null, new Set([mockDatasources.datasources[0].id])],
        workbookIds: [null], // n/a for datasources
        viewIds: [null], // n/a for datasources
        tags: [null, new Set([mockDatasources.datasources[0].tags.tag[0].label])],
      }),
    )(
      'should return success result when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
      async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        const result = constrainDatasources({
          datasources: mockDatasources.datasources,
          boundedContext: {
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          },
        });

        invariant(result.type === 'success');
        if (!projectIds && !datasourceIds && !tags) {
          expect(result.result).toEqual(mockDatasources.datasources);
        } else {
          expect(result.result).toEqual([mockDatasources.datasources[0]]);
        }
      },
    );
  });
});

async function getToolResult(params: {
  filter?: string;
  resolveContentUrl?: string;
  pageSize?: number;
  limit?: number;
  insightsToolsEnabled?: boolean;
}): Promise<CallToolResult> {
  const listDatasourcesTool = getListDatasourcesTool(new WebMcpServer());
  const callback = await Provider.from(listDatasourcesTool.callback);
  const extra = getMockRequestHandlerExtra();
  extra.config.insightsToolsEnabled = params.insightsToolsEnabled ?? true;
  return await callback(
    {
      filter: params.filter,
      resolveContentUrl: params.resolveContentUrl,
      pageSize: params.pageSize,
      limit: params.limit,
    },
    extra,
  );
}
