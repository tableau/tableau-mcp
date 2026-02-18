import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import { getCombinationsOfBoundedContextInputs } from '../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
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
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      workbooksMethods: {
        queryWorkbooksForSite: mocks.mockQueryWorkbooksForSite,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listWorkbooksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listWorkbooksTool = getListWorkbooksTool(new Server());
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

  describe('constrainWorkbooks', () => {
    it('should return empty result when no workbooks are found', () => {
      const result = constrainWorkbooks({
        workbooks: [],
        boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null, tags: null },
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
        tags: [null, new Set([mockWorkbook.tags.tag[0].label])],
      }),
    )(
      'should return success result when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
      async ({ projectIds, datasourceIds, workbookIds, tags }) => {
        const result = constrainWorkbooks({
          workbooks: [mockWorkbook, mockWorkbook2],
          boundedContext: {
            projectIds,
            datasourceIds,
            workbookIds,
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

async function getToolResult(params: { filter: string }): Promise<CallToolResult> {
  const listWorkbooksTool = getListWorkbooksTool(new Server());
  const callback = await Provider.from(listWorkbooksTool.callback);
  return await callback(
    { filter: params.filter, pageSize: undefined, limit: undefined },
    getMockRequestHandlerExtra(),
  );
}
