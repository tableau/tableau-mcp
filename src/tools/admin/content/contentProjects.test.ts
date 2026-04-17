import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../../server.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getContentProjectsTool } from './contentProjects.js';

const mocks = vi.hoisted(() => ({
  mockQueryProjects: vi.fn(),
  mockCreateProject: vi.fn(),
  mockUpdateProject: vi.fn(),
  mockDeleteProject: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      projectsMethods: {
        queryProjects: mocks.mockQueryProjects,
        createProject: mocks.mockCreateProject,
        updateProject: mocks.mockUpdateProject,
        deleteProject: mocks.mockDeleteProject,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('content-projects tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  it('should create a tool instance', () => {
    const tool = getContentProjectsTool(new Server());
    expect(tool.name).toBe('content-projects');
  });

  it('should query projects', async () => {
    mocks.mockQueryProjects.mockResolvedValue({
      projects: { project: [{ id: 'proj-1', name: 'Project 1' }] },
    });

    const tool = getContentProjectsTool(new Server());
    await tool.callback(
      { operation: 'query-projects', filter: 'name:eq:Sales' },
      getMockRequestHandlerExtra(),
    );

    expect(mocks.mockQueryProjects).toHaveBeenCalled();
  });

  it('should create project', async () => {
    mocks.mockCreateProject.mockResolvedValue({ project: { id: 'proj-123' } });

    const tool = getContentProjectsTool(new Server());
    await tool.callback(
      {
        operation: 'create-project',
        body: { project: { name: 'New Project' } },
      },
      getMockRequestHandlerExtra(),
    );

    expect(mocks.mockCreateProject).toHaveBeenCalled();
  });
});
