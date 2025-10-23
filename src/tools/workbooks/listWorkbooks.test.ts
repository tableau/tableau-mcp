import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import invariant from '../../utils/invariant.js';
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
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('constrainWorkbooks', () => {
    it('should return empty result when no workbooks are found', () => {
      const result = constrainWorkbooks({
        workbooks: [],
        boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No workbooks were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all workbooks were filtered out by the bounded context', () => {
      const result = constrainWorkbooks({
        workbooks: [mockWorkbook],
        boundedContext: { projectIds: new Set(['123']), datasourceIds: null, workbookIds: null },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed workbooks that can be queried is limited by the server configuration.',
          'While workbooks were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    it('should return success result when no workbooks were filtered out by the bounded context', () => {
      const result = constrainWorkbooks({
        workbooks: [mockWorkbook],
        boundedContext: { projectIds: null, datasourceIds: null, workbookIds: null },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([mockWorkbook]);
    });

    it('should return success result when some workbooks were filtered out by the bounded context', () => {
      const result = constrainWorkbooks({
        workbooks: [mockWorkbook, mockWorkbook2],
        boundedContext: {
          projectIds: new Set([mockWorkbook.project.id]),
          datasourceIds: new Set([mockWorkbook.id]),
          workbookIds: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([mockWorkbook]);
    });
  });
});

async function getToolResult(params: { filter: string }): Promise<CallToolResult> {
  const listWorkbooksTool = getListWorkbooksTool(new Server());
  return await listWorkbooksTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
