import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { getCombinationsOfBoundedContextInputs } from '../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { constrainProjects, getListProjectsTool } from './listProjects.js';
import { mockProject, mockProject2 } from './mockProject.js';

const mockProjectsResponse = {
  pagination: {
    pageNumber: 1,
    pageSize: 10,
    totalAvailable: 1,
  },
  projects: [mockProject],
};

const mocks = vi.hoisted(() => ({
  mockQueryProjects: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      projectsMethods: {
        queryProjects: mocks.mockQueryProjects,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listProjectsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listProjectsTool = getListProjectsTool(new WebMcpServer());
    expect(listProjectsTool.name).toBe('list-projects');
    expect(listProjectsTool.description).toContain(
      'Retrieves a list of projects on a Tableau site',
    );
    expect(listProjectsTool.paramsSchema).toMatchObject({});
  });

  it('should successfully query projects', async () => {
    mocks.mockQueryProjects.mockResolvedValue(mockProjectsResponse);
    const result = await getToolResult({ filter: 'name:eq:Samples' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Samples');
    expect(mocks.mockQueryProjects).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Samples',
      pageSize: 1000,
      pageNumber: undefined,
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryProjects.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Samples' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('constrainProjects', () => {
    it('should return empty result when no projects are found', () => {
      const result = constrainProjects({
        projects: [],
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
        'No projects were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all projects were filtered out by the bounded context', () => {
      const result = constrainProjects({
        projects: [mockProject],
        boundedContext: {
          projectIds: new Set(['unrelated-id']),
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed projects that can be queried is limited by the server configuration.',
          'While projects were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    test.each(
      getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set([mockProject.id])],
        datasourceIds: [null], // n/a for projects
        workbookIds: [null], // n/a for projects
        viewIds: [null], // n/a for projects
        tags: [null], // n/a for projects
      }),
    )(
      'should return success result when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
      async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        const result = constrainProjects({
          projects: [mockProject, mockProject2],
          boundedContext: {
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          },
        });

        invariant(result.type === 'success');
        if (!projectIds) {
          expect(result.result).toEqual([mockProject, mockProject2]);
        } else {
          expect(result.result).toEqual([mockProject]);
        }
      },
    );
  });
});

async function getToolResult(params: { filter: string }): Promise<CallToolResult> {
  const listProjectsTool = getListProjectsTool(new WebMcpServer());
  const callback = await Provider.from(listProjectsTool.callback);
  return await callback(
    { filter: params.filter, limit: undefined },
    getMockRequestHandlerExtra(),
  );
}
