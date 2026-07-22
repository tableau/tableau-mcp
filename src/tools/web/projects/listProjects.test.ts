import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
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

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toContainEqual(expect.objectContaining({ name: 'Samples' }));
    expect(parsed.totalAvailable).toBe(mockProjectsResponse.pagination.totalAvailable);

    expect(mocks.mockQueryProjects).toHaveBeenCalledTimes(1);
    expect(mocks.mockQueryProjects).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Samples',
      pageSize: 1000,
      pageNumber: 1,
    });
  });

  it('should fetch only a single page and not loop when more results are available', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      ...mockProject,
      id: `project-${i}`,
    }));
    mocks.mockQueryProjects.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2600 },
      projects: fullPage,
    });

    const result = await getToolResult({ filter: 'name:eq:Samples' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBeLessThanOrEqual(1000);
    expect(parsed.data.length).toBe(1000);
    expect(parsed.totalAvailable).toBe(2600);

    // Single-page semantics: the REST method must be called exactly once (no looping).
    expect(mocks.mockQueryProjects).toHaveBeenCalledTimes(1);
  });

  it('should fetch the requested page number', async () => {
    mocks.mockQueryProjects.mockResolvedValue(mockProjectsResponse);
    const result = await getToolResult({ filter: 'name:eq:Samples', pageNumber: 3 });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryProjects).toHaveBeenCalledTimes(1);
    expect(mocks.mockQueryProjects).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Samples',
      pageSize: 1000,
      pageNumber: 3,
    });
  });

  it('should trim the page to the caller limit without capping totalAvailable', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      ...mockProject,
      id: `project-${i}`,
    }));
    mocks.mockQueryProjects.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2600 },
      projects: fullPage,
    });

    const result = await getToolResult({ filter: 'name:eq:Samples', limit: 600 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBe(600);
    expect(parsed.totalAvailable).toBe(2600);
    expect(mocks.mockQueryProjects).toHaveBeenCalledTimes(1);
    // pageSize sent to the API is always the full page (limit is applied client-side).
    expect(mocks.mockQueryProjects).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Samples',
      pageSize: 1000,
      pageNumber: 1,
    });
  });

  it('should cap totalAvailable and trim when a server maxResultLimit cuts the page short', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      ...mockProject,
      id: `project-${i}`,
    }));
    mocks.mockQueryProjects.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2600 },
      projects: fullPage,
    });

    const result = await getToolResult({ filter: 'name:eq:Samples', maxResultLimit: 700 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBe(700);
    expect(parsed.totalAvailable).toBe(700);
    expect(mocks.mockQueryProjects).toHaveBeenCalledTimes(1);
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

async function getToolResult(params: {
  filter: string;
  pageNumber?: number;
  limit?: number;
  maxResultLimit?: number;
}): Promise<CallToolResult> {
  const listProjectsTool = getListProjectsTool(new WebMcpServer());
  const callback = await Provider.from(listProjectsTool.callback);
  const extra = getMockRequestHandlerExtra();

  if (params.maxResultLimit !== undefined) {
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(
        new OverridableConfig({ MAX_RESULT_LIMIT: String(params.maxResultLimit) }),
      );
  }

  return await callback(
    { filter: params.filter, pageNumber: params.pageNumber, limit: params.limit },
    extra,
  );
}
