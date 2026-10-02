import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import { DestinationProject } from '../../../sdks/tableau/types/project.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  constrainDestinationProjects,
  getListDestinationProjectsTool,
} from './listDestinationProjects.js';

const validProject = {
  id: 'ae5e9374-2a58-40ab-93e4-a2fd1b07cf7d',
  name: 'Samples',
  topLevelProject: true,
  isDefaultProject: false,
  childProjectCount: 1,
  status: 'VALID',
  owner: { id: 'fe1c0c8d-1d95-4d4d-9a1e-3a3f0a8e4b1a', name: 'admin' },
} satisfies DestinationProject;

const forbiddenProject = {
  id: '4862efd9-3c24-4053-ae1f-18caf18b6ffe',
  name: 'Finance',
  parentProjectId: validProject.id,
  topLevelProject: false,
  childProjectCount: 0,
  status: 'INSUFFICIENT_PERMISSIONS',
} satisfies DestinationProject;

const mockResponse = {
  pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2 },
  projects: [validProject, forbiddenProject],
};

const noBoundedContext = {
  projectIds: null,
  datasourceIds: null,
  workbookIds: null,
  viewIds: null,
  tags: null,
};

const mocks = vi.hoisted(() => ({
  mockQueryDestinationProjects: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      destinationProjectsMethods: {
        queryDestinationProjects: mocks.mockQueryDestinationProjects,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

function axiosError(status: number, tableauErrorCode?: string): Error {
  const error = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; data?: unknown };
  };
  error.isAxiosError = true;
  error.response = {
    status,
    ...(tableauErrorCode
      ? { data: { error: { code: tableauErrorCode, summary: 'Forbidden', detail: 'test' } } }
      : {}),
  };
  return error;
}

describe('listDestinationProjectsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListDestinationProjectsTool(new WebMcpServer());
    expect(tool.name).toBe('list-destination-projects');
    expect(tool.description).toContain('candidate destinations for publishing or moving content');
    expect(tool.requiredApiScopes).toEqual(
      expect.arrayContaining(['tableau:projects:read', 'tableau:mcp_site_settings:read']),
    );
  });

  it('should default contentType to workbook and return projects of every status', async () => {
    mocks.mockQueryDestinationProjects.mockResolvedValue(mockResponse);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data).toEqual([validProject, forbiddenProject]);
    expect(parsed.totalAvailable).toBe(2);

    expect(mocks.mockQueryDestinationProjects).toHaveBeenCalledTimes(1);
    expect(mocks.mockQueryDestinationProjects).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      contentType: 'workbook',
      sourceIds: undefined,
      filter: undefined,
      pageSize: 1000,
      pageNumber: 1,
    });
  });

  it('should pass contentType, sourceIds, filter, and pageNumber through', async () => {
    mocks.mockQueryDestinationProjects.mockResolvedValue(mockResponse);
    const result = await getToolResult({
      contentType: 'project',
      sourceIds: ['src-1', 'src-2'],
      filter: 'topLevelProject:eq:true',
      pageNumber: 2,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryDestinationProjects).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      contentType: 'project',
      sourceIds: ['src-1', 'src-2'],
      filter: 'topLevelProject:eq:true',
      pageSize: 1000,
      pageNumber: 2,
    });
  });

  it('should trim the page to the caller limit without capping totalAvailable', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      ...validProject,
      id: `project-${i}`,
    }));
    mocks.mockQueryDestinationProjects.mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 2600 },
      projects: fullPage,
    });

    const result = await getToolResult({ limit: 600 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.data.length).toBe(600);
    expect(parsed.totalAvailable).toBe(2600);
    expect(mocks.mockQueryDestinationProjects).toHaveBeenCalledTimes(1);
  });

  it('should return a page-exceeds-limit error without fetching when the page is past the cap', async () => {
    const result = await getToolResult({ pageNumber: 4, maxResultLimit: 2700 });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('The requested page (4) exceeds the response limit');
    expect(mocks.mockQueryDestinationProjects).not.toHaveBeenCalled();
  });

  it('should map a 403 with Tableau code 403157 to an "API not enabled" error', async () => {
    mocks.mockQueryDestinationProjects.mockRejectedValue(axiosError(403, '403157'));

    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'experimental destination projects API is not enabled',
    );
    expect(result.content[0].text).toContain('list-projects');
  });

  it('should not report a non-403157 403 as the API being disabled', async () => {
    mocks.mockQueryDestinationProjects.mockRejectedValue(axiosError(403, '403126'));

    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain(
      'experimental destination projects API is not enabled',
    );
  });

  it('should handle API errors gracefully', async () => {
    mocks.mockQueryDestinationProjects.mockRejectedValue(new Error('API Error'));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('API Error');
  });

  describe('constrainDestinationProjects', () => {
    it('should return empty result when no projects are found', () => {
      const result = constrainDestinationProjects({
        projects: [],
        boundedContext: noBoundedContext,
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No destination projects were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty result when all projects were filtered out by the bounded context', () => {
      const result = constrainDestinationProjects({
        projects: [validProject],
        boundedContext: { ...noBoundedContext, projectIds: new Set(['unrelated-id']) },
      });

      invariant(result.type === 'empty');
      expect(result.message).toContain('limited by the server configuration');
    });

    it('should keep only projects in the bounded context', () => {
      const result = constrainDestinationProjects({
        projects: [validProject, forbiddenProject],
        boundedContext: { ...noBoundedContext, projectIds: new Set([validProject.id]) },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([validProject]);
    });

    it('should return all projects when there is no bounded context', () => {
      const result = constrainDestinationProjects({
        projects: [validProject, forbiddenProject],
        boundedContext: noBoundedContext,
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([validProject, forbiddenProject]);
    });
  });
});

async function getToolResult(params: {
  contentType?: 'workbook' | 'datasource' | 'flow' | 'project';
  sourceIds?: string[];
  filter?: string;
  pageNumber?: number;
  limit?: number;
  maxResultLimit?: number;
}): Promise<CallToolResult> {
  const tool = getListDestinationProjectsTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = getMockRequestHandlerExtra();

  if (params.maxResultLimit !== undefined) {
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(
        new OverridableConfig({ MAX_RESULT_LIMIT: String(params.maxResultLimit) }),
      );
  }

  return await callback(
    {
      contentType: params.contentType ?? 'workbook',
      sourceIds: params.sourceIds,
      filter: params.filter,
      pageNumber: params.pageNumber,
      limit: params.limit,
    },
    extra,
  );
}
