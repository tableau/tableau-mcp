import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { getCombinationsOfBoundedContextInputs } from '../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
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

const mocks = vi.hoisted(() => ({
  mockQueryWorkbooksForSite: vi.fn(),
  mockGetWorkbook: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        queryWorkbooksForSite: mocks.mockQueryWorkbooksForSite,
        getWorkbook: mocks.mockGetWorkbook,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listWorkbooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(result.content[0].text).toContain('Superstore');
    expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Superstore',
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryWorkbooksForSite.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Superstore' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('INCLUDE_WORKBOOK_IDS fast path (fetch by ID)', () => {
    function makeAxiosError(status: number): Error {
      return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status },
      });
    }

    it('should fetch workbooks by ID when INCLUDE_WORKBOOK_IDS is set and no filter is provided', async () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', `${mockWorkbook.id},${mockWorkbook2.id}`);
      mocks.mockGetWorkbook.mockImplementation(async ({ workbookId }: { workbookId: string }) =>
        workbookId === mockWorkbook.id ? mockWorkbook : mockWorkbook2,
      );

      const result = await getToolResult({});

      expect(result.isError).toBe(false);
      expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(2);
      expect(mocks.mockGetWorkbook).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        workbookId: mockWorkbook.id,
      });
      expect(mocks.mockQueryWorkbooksForSite).not.toHaveBeenCalled();

      invariant(result.content[0].type === 'text');
      const workbooks = JSON.parse(`${result.content[0].text}`);
      expect(workbooks.map((w: { id: string }) => w.id).sort()).toEqual(
        [mockWorkbook.id, mockWorkbook2.id].sort(),
      );
    });

    it('should silently omit workbooks that return 403 or 404', async () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', `${mockWorkbook.id},not-allowed,missing`);
      mocks.mockGetWorkbook.mockImplementation(async ({ workbookId }: { workbookId: string }) => {
        if (workbookId === 'not-allowed') {
          throw makeAxiosError(403);
        }
        if (workbookId === 'missing') {
          throw makeAxiosError(404);
        }
        return mockWorkbook;
      });

      const result = await getToolResult({});

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const workbooks = JSON.parse(`${result.content[0].text}`);
      expect(workbooks).toHaveLength(1);
      expect(workbooks[0].id).toBe(mockWorkbook.id);
    });

    it('should propagate non-403/404 errors', async () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', `${mockWorkbook.id},boom`);
      mocks.mockGetWorkbook.mockImplementation(async ({ workbookId }: { workbookId: string }) => {
        if (workbookId === 'boom') {
          throw makeAxiosError(500);
        }
        return mockWorkbook;
      });

      const result = await getToolResult({});

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('500');
    });

    it('should use the slow path when a filter is provided alongside INCLUDE_WORKBOOK_IDS', async () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', mockWorkbook.id);
      mocks.mockQueryWorkbooksForSite.mockResolvedValue(mockWorkbooksResponse);

      const result = await getToolResult({ filter: 'name:eq:Superstore' });

      expect(result.isError).toBe(false);
      expect(mocks.mockQueryWorkbooksForSite).toHaveBeenCalledTimes(1);
      expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    });

    it('should still apply coexisting bounds (e.g. project) to fetched workbooks', async () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', `${mockWorkbook.id},${mockWorkbook2.id}`);
      // Only mockWorkbook's project is allowed; mockWorkbook2 must be filtered out by constrainWorkbooks.
      vi.stubEnv('INCLUDE_PROJECT_IDS', mockWorkbook.project.id);
      mocks.mockGetWorkbook.mockImplementation(async ({ workbookId }: { workbookId: string }) =>
        workbookId === mockWorkbook.id ? mockWorkbook : mockWorkbook2,
      );

      const result = await getToolResult({});

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const workbooks = JSON.parse(`${result.content[0].text}`);
      expect(workbooks).toHaveLength(1);
      expect(workbooks[0].id).toBe(mockWorkbook.id);
    });

    it('should slice fetched workbooks to the effective limit', async () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', `${mockWorkbook.id},${mockWorkbook2.id}`);
      mocks.mockGetWorkbook.mockImplementation(async ({ workbookId }: { workbookId: string }) =>
        workbookId === mockWorkbook.id ? mockWorkbook : mockWorkbook2,
      );

      const result = await getToolResult({ limit: 1 });

      expect(result.isError).toBe(false);
      // All allowed workbooks are fetched before slicing, then trimmed to the limit.
      expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(2);
      invariant(result.content[0].type === 'text');
      const workbooks = JSON.parse(`${result.content[0].text}`);
      expect(workbooks).toHaveLength(1);
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

async function getToolResult(params: { filter?: string; limit?: number }): Promise<CallToolResult> {
  const listWorkbooksTool = getListWorkbooksTool(new WebMcpServer());
  const callback = await Provider.from(listWorkbooksTool.callback);
  return await callback(
    { filter: params.filter, pageSize: undefined, limit: params.limit },
    getMockRequestHandlerExtra(),
  );
}
