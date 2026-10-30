import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodiosError } from '@zodios/core';

import * as loggerModule from '../../../logging/logger.js';
import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { getCombinationsOfBoundedContextInputs } from '../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { constrainWorkbooks, getListWorkbooksTool } from './listWorkbooks.js';
import { mockWorkbook, mockWorkbook2 } from './mockWorkbook.js';

const mockWorkbooksResponse = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 1,
  },
  workbooks: [{ workbook: mockWorkbook }],
};

function makePageOfWorkbooks(count: number): Array<{ workbook: typeof mockWorkbook }> {
  return Array.from({ length: count }, (_, i) => ({
    workbook: { ...mockWorkbook, id: `workbook-${i}`, name: `Workbook ${i}` },
  }));
}

const mocks = vi.hoisted(() => ({
  mockQueryWorkbooksForSite: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        queryWorkbooksForSite: mocks.mockQueryWorkbooksForSite,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('listWorkbooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tag-only discovery', () => {
    it.each([
      { labels: ['Sales'], expected: 'tags:eq:Sales' },
      { labels: ['Sales', 'Finance', 'Sales'], expected: 'tags:in:[Sales,Finance]' },
      { labels: ['売上 #1'], expected: 'tags:eq:売上 #1' },
      { labels: ['pending-deletion-2026-10-14'], expected: 'tags:eq:pending-deletion-2026-10-14' },
    ])(
      'passes $expected through the native list API with normal pagination',
      async ({ labels, expected }) => {
        mocks.mockQueryWorkbooksForSite.mockResolvedValue(mockWorkbooksResponse);
        const result = await getToolResult({ tagLabels: labels, pageNumber: 2, limit: 5 });
        expect(result.isError).toBe(false);
        expect(vi.mocked(useRestApi).mock.calls.at(-1)?.[0].disableLogging).toBe(true);
        expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({
            filter: expected,
            pageNumber: 2,
            pageSize: 1000,
          }),
        );
      },
    );

    it('contains malformed tag-search response metadata without notifications', async () => {
      const sentinel = 'SYNTHETIC_TAG_SEARCH_METADATA';
      mocks.mockQueryWorkbooksForSite.mockRejectedValueOnce(
        new ZodiosError(`Malformed response ${sentinel}`),
      );
      const result = await getToolResult({ tagLabels: ['Sales'] });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'Tableau returned an invalid content response. Tag search results could not be verified.',
        },
      ]);
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(vi.mocked(useRestApi).mock.calls.at(-1)?.[0].disableLogging).toBe(true);
    });

    it('ANDs non-tag filter fields with the typed tag condition', async () => {
      mocks.mockQueryWorkbooksForSite.mockResolvedValue(mockWorkbooksResponse);
      const result = await getToolResult({
        filter: 'projectName:eq:Finance',
        tagLabels: ['Sales'],
      });
      expect(result.isError).toBe(false);
      expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledWith(
        expect.objectContaining({ filter: 'projectName:eq:Finance,tags:eq:Sales' }),
      );
    });

    it.each([
      { labels: ['A,B'], filter: undefined },
      { labels: ['Sales],name:eq:Secret'], filter: undefined },
      { labels: ['%252C'], filter: undefined },
      { labels: ['Sales'], filter: 'tags:eq:Old' },
    ])('rejects ambiguous tag inputs before REST', async ({ labels, filter }) => {
      const result = await getToolResult({ filter, tagLabels: labels });
      expect(result.isError).toBe(true);
      expect(mocks.mockQueryWorkbooksForSite).not.toHaveBeenCalled();
    });
  });

  it('should create a tool instance with correct properties', () => {
    const listWorkbooksTool = getListWorkbooksTool(new WebMcpServer());
    expect(listWorkbooksTool.name).toBe('list-workbooks');
    expect(listWorkbooksTool.description).toContain(
      'Retrieves a list of workbooks on a Tableau site',
    );
    expect(listWorkbooksTool.paramsSchema).toMatchObject({});
  });

  it('should successfully query workbooks', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue(mockWorkbooksResponse);
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(JSON.stringify(parsed.data)).toContain('Superstore');
    expect(parsed.data).toHaveLength(1);
    expect(parsed.totalAvailable).toBe(1);

    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledTimes(1);
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: 1000,
      pageNumber: 1,
    });
  });

  it('should fetch only a single page and not loop when more results are available', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue({
      pagination: {
        pageNumber: 1,
        pageSize: 1000,
        totalAvailable: 2600,
      },
      workbooks: makePageOfWorkbooks(1000),
    });

    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBeLessThanOrEqual(1000);
    expect(parsed.data).toHaveLength(1000);
    expect(parsed.totalAvailable).toBe(2600);

    // Single-page semantics: the REST method is called exactly once (no looping).
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledTimes(1);
  });

  it('should pass pageNumber through to the REST API', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue({
      pagination: {
        pageNumber: 3,
        pageSize: 1000,
        totalAvailable: 2600,
      },
      workbooks: makePageOfWorkbooks(600),
    });

    await getToolResult({ filter: 'name:eq:Superstore', pageNumber: 3 });

    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledTimes(1);
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: 1000,
      pageNumber: 3,
    });
  });

  it('should trim the page to the caller-provided limit without capping totalAvailable', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue({
      pagination: {
        pageNumber: 1,
        pageSize: 1000,
        totalAvailable: 2600,
      },
      workbooks: makePageOfWorkbooks(1000),
    });

    const result = await getToolResult({ filter: 'name:eq:Superstore', limit: 600 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toHaveLength(600);
    // The caller's own `limit` never caps totalAvailable.
    expect(parsed.totalAvailable).toBe(2600);
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledTimes(1);
  });

  it('should cap totalAvailable and trim the page when a server maxResultLimit is smaller than the page', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue({
      pagination: {
        pageNumber: 1,
        pageSize: 1000,
        totalAvailable: 2600,
      },
      workbooks: makePageOfWorkbooks(1000),
    });

    // Global server cap of 600 across pages.
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '600' }));

    const result = await getToolResult({ filter: 'name:eq:Superstore' }, extra);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toHaveLength(600);
    // The server cap trimmed this page below what the API returned, so totalAvailable is capped.
    expect(parsed.totalAvailable).toBe(600);
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledTimes(1);
  });

  it('should return a page-exceeds-limit error without fetching when the page is past the cap', async () => {
    // Cap of 2700: page 3 (offset 2000) is reachable, page 4 (offset 3000) is not.
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '2700' }));

    const result = await getToolResult({ filter: 'name:eq:Superstore', pageNumber: 4 }, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('The requested page (4) exceeds the response limit');
    expect(result.content[0].text).toContain('the highest page you can request is 3');
    expect(mocks.mockQueryWorkbooksForSite).not.toHaveBeenCalled();
  });

  it('should still fetch the last reachable page under a cap that trims it', async () => {
    mocks.mockQueryWorkbooksForSite.mockResolvedValue({
      pagination: {
        pageNumber: 3,
        pageSize: 1000,
        totalAvailable: 2800,
      },
      workbooks: makePageOfWorkbooks(1000),
    });

    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '2700' }));

    // Page 3 starts at offset 2000; cap 2700 leaves 700 reachable items and
    // caps the reported total (min(2800, 2700)).
    const result = await getToolResult({ filter: 'name:eq:Superstore', pageNumber: 3 }, extra);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toHaveLength(700);
    expect(parsed.totalAvailable).toBe(2700);
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledTimes(1);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryWorkbooksForSite.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('mcp.resultInfo (server cap hides workbooks)', () => {
    function mockFullPage(rawTotal: number): void {
      mocks.mockQueryWorkbooksForSite.mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: rawTotal },
        workbooks: Array.from({ length: 1000 }, (_, i) => ({
          ...mockWorkbook,
          id: `workbook-${i}`,
          project: { name: 'Project', id: i % 2 === 0 ? 'p1' : 'p2' },
        })),
      });
    }

    async function getParsed(params: {
      limit?: number;
      maxResultLimit: number | null;
      projectIds?: Set<string>;
    }): Promise<any> {
      const extra = getMockRequestHandlerExtra();
      const config = new OverridableConfig({});
      vi.spyOn(config, 'getMaxResultLimit').mockReturnValue(params.maxResultLimit);
      if (params.projectIds) {
        config.boundedContext = { ...config.boundedContext, projectIds: params.projectIds };
      }
      extra.getConfigWithOverrides = vi.fn().mockResolvedValue(config);

      const result = await getToolResult(
        { filter: 'name:eq:Superstore', limit: params.limit },
        extra,
      );
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      return JSON.parse(result.content[0].text);
    }

    it('reports admin-cap when the cap is below the raw total', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({ maxResultLimit: 700 });

      expect(parsed.data).toHaveLength(700);
      expect(parsed.totalAvailable).toBe(700);
      expect(Object.keys(parsed).sort()).toEqual(['data', 'mcp', 'totalAvailable']);
      expect(parsed.mcp).toEqual({
        resultInfo: { returnedCount: 700, truncated: true, truncationReason: 'admin-cap' },
      });
    });

    it('reports admin-cap on a limit: 1 count call under a binding cap', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({ limit: 1, maxResultLimit: 700 });

      expect(parsed.totalAvailable).toBe(700);
      expect(parsed.mcp.resultInfo.returnedCount).toBe(1);
      expect(parsed.mcp.resultInfo.truncationReason).toBe('admin-cap');
    });

    it('counts returnedCount after the bounded-context filter', async () => {
      mockFullPage(2600);

      const parsed = await getParsed({ maxResultLimit: 700, projectIds: new Set(['p1']) });

      expect(parsed.data).toHaveLength(350);
      expect(parsed.totalAvailable).toBe(700);
      expect(parsed.mcp.resultInfo.returnedCount).toBe(350);
    });

    it('omits mcp with no cap, a non-binding cap, or only a caller limit', async () => {
      mockFullPage(2600);

      const noCap = await getParsed({ maxResultLimit: null });
      const nonBindingCap = await getParsed({ maxResultLimit: 2600 });
      const limitOnly = await getParsed({ limit: 1, maxResultLimit: null });

      expect(noCap).not.toHaveProperty('mcp');
      expect(Object.keys(noCap).sort()).toEqual(['data', 'totalAvailable']);
      expect(nonBindingCap).not.toHaveProperty('mcp');
      expect(Object.keys(nonBindingCap).sort()).toEqual(['data', 'totalAvailable']);
      expect(nonBindingCap.totalAvailable).toBe(2600);
      expect(limitOnly).not.toHaveProperty('mcp');
      expect(limitOnly.totalAvailable).toBe(2600);
    });
  });

  describe('constrainWorkbooks', () => {
    it('should return empty result when no workbooks are found', () => {
      const result = constrainWorkbooks({
        workbooks: [],
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
        'No workbooks were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all workbooks were filtered out by the bounded context', () => {
      const result = constrainWorkbooks({
        workbooks: [mockWorkbook],
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
          'The set of allowed workbooks that can be queried is limited by the server configuration.',
          'While workbooks were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    test.each(
      getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set([mockWorkbook.project.id])],
        datasourceIds: [null], // n/a for workbooks
        workbookIds: [null, new Set([mockWorkbook.id])],
        viewIds: [null], // n/a for workbooks
        tags: [null, new Set([mockWorkbook.tags.tag[0].label])],
      }),
    )(
      'should return success result when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
      async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        const result = constrainWorkbooks({
          workbooks: [mockWorkbook, mockWorkbook2],
          boundedContext: {
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          },
        });

        invariant(result.type === 'success');
        if (!projectIds && !datasourceIds && !workbookIds && !tags) {
          expect(result.result).toEqual([mockWorkbook, mockWorkbook2]);
        } else {
          expect(result.result).toEqual([mockWorkbook]);
        }
      },
    );
  });
});

async function getToolResult(
  params: { filter?: string; tagLabels?: string[]; pageNumber?: number; limit?: number },
  extra: TableauWebRequestHandlerExtra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const listWorkbooksTool = getListWorkbooksTool(new WebMcpServer());
  const callback = await Provider.from(listWorkbooksTool.callback);
  return await callback(
    {
      filter: params.filter,
      tagLabels: params.tagLabels,
      pageNumber: params.pageNumber,
      limit: params.limit,
    },
    extra,
  );
}
