import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListExtractRefreshTasksTool } from './listExtractRefreshTasks.js';
import { mockExtractRefreshTask } from './mockExtractRefreshTask.js';

const mockTasks = [mockExtractRefreshTask];

const mocks = vi.hoisted(() => ({
  mockListExtractRefreshTasks: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      tasksMethods: {
        listExtractRefreshTasks: mocks.mockListExtractRefreshTasks,
      },
      usersMethods: {
        getUser: vi.fn().mockResolvedValue({ siteRole: 'SiteAdministratorCreator' }),
      },
      siteId: 'test-site-id',
      userId: 'test-user-id',
    }),
  ),
}));

vi.mock('../_lib/adminGate.js', () => ({
  adminGate: {
    assertAdmin: mocks.mockAssertAdmin,
  },
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

describe('listExtractRefreshTasksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listExtractRefreshTasksTool = getListExtractRefreshTasksTool(new WebMcpServer());
    expect(listExtractRefreshTasksTool.name).toBe('list-extract-refresh-tasks');
    expect(listExtractRefreshTasksTool.description).toContain(
      'Retrieves a list of extract refresh tasks for the Tableau site',
    );
    expect(listExtractRefreshTasksTool.paramsSchema).toEqual({});
  });

  it('should successfully get extract refresh tasks', async () => {
    mocks.mockListExtractRefreshTasks.mockResolvedValue(mockTasks);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(`${result.content[0].text}`)).toEqual(mockTasks);
    expect(mocks.mockListExtractRefreshTasks).toHaveBeenCalledWith({
      siteId: 'test-site-id',
    });
  });

  it('should return empty message when no tasks are found', async () => {
    mocks.mockListExtractRefreshTasks.mockResolvedValue([]);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      'No extract refresh tasks were found. Either none exist or you do not have permission to view them.',
    );
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListExtractRefreshTasks.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should handle tasks with datasource', async () => {
    const taskWithDatasource = {
      ...mockExtractRefreshTask,
      datasource: { id: 'datasource-123' },
      workbook: undefined,
    };
    mocks.mockListExtractRefreshTasks.mockResolvedValue([taskWithDatasource]);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed[0].datasource.id).toBe('datasource-123');
    expect(parsed[0].workbook).toBeUndefined();
  });

  it('should handle tasks with workbook', async () => {
    const taskWithWorkbook = {
      ...mockExtractRefreshTask,
      datasource: undefined,
      workbook: { id: 'workbook-456' },
    };
    mocks.mockListExtractRefreshTasks.mockResolvedValue([taskWithWorkbook]);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed[0].workbook.id).toBe('workbook-456');
    expect(parsed[0].datasource).toBeUndefined();
  });

  it('should handle tasks with schedule information', async () => {
    const taskWithSchedule = {
      ...mockExtractRefreshTask,
      schedule: {
        id: 'schedule-789',
        name: 'Daily Refresh',
        frequency: 'Daily',
        nextRunAt: '2026-05-21T08:00:00Z',
      },
    };
    mocks.mockListExtractRefreshTasks.mockResolvedValue([taskWithSchedule]);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed[0].schedule.name).toBe('Daily Refresh');
    expect(parsed[0].schedule.frequency).toBe('Daily');
  });
});

async function getToolResult(args: Record<string, never>): Promise<CallToolResult> {
  const listExtractRefreshTasksTool = getListExtractRefreshTasksTool(new WebMcpServer());
  return listExtractRefreshTasksTool.callback(args, getMockRequestHandlerExtra());
}
