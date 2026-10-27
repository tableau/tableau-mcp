import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import * as loggerModule from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListExtractRefreshTasksTool } from './listExtractRefreshTasks.js';
import { mockExtractRefreshTask } from './mockExtractRefreshTask.js';

const mockTasks = [mockExtractRefreshTask];

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockListExtractRefreshTasks: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      tasksMethods: {
        listExtractRefreshTasks: mocks.mockListExtractRefreshTasks,
      },
      usersMethods: {
        queryUserOnSite: mocks.mockQueryUserOnSite,
      },
      siteId: 'test-site-id',
      userId: 'test-user-id',
    }),
  ),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('listExtractRefreshTasksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
  });

  it('should create a tool instance with correct properties', () => {
    const listExtractRefreshTasksTool = getListExtractRefreshTasksTool(new WebMcpServer());
    expect(listExtractRefreshTasksTool.name).toBe('list-extract-refresh-tasks');
    expect(listExtractRefreshTasksTool.description).toContain(
      'Retrieves a list of extract refresh tasks for the Tableau site',
    );
    expect(listExtractRefreshTasksTool.paramsSchema).toHaveProperty('filter');
    expect(listExtractRefreshTasksTool.paramsSchema).toHaveProperty('pageSize');
    expect(listExtractRefreshTasksTool.paramsSchema).toHaveProperty('limit');
  });

  it.each([
    [true, true, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ])(
    'ADMIN_TOOLS_ENABLED=%s, admin-tools flag=%s → disabled=%s',
    async (adminToolsEnabled, flag, disabled) => {
      const { getConfig } = await import('../../../config.js');
      vi.mocked(getConfig).mockReturnValueOnce({ adminToolsEnabled } as ReturnType<
        typeof getConfig
      >);
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => flag && featureName === 'admin-tools',
      );
      const tool = getListExtractRefreshTasksTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(disabled);
    },
  );

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

  it('should respect limit parameter', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      ...mockExtractRefreshTask,
      id: `task-${i}`,
    }));
    mocks.mockListExtractRefreshTasks.mockResolvedValue(tasks);
    const result = await getToolResult({ limit: 2 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed).toHaveLength(2);
  });

  it('should respect pageSize parameter', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      ...mockExtractRefreshTask,
      id: `task-${i}`,
    }));
    mocks.mockListExtractRefreshTasks.mockResolvedValue(tasks);
    const result = await getToolResult({ pageSize: 3 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed).toHaveLength(3);
  });

  it('should use the smaller of pageSize and limit', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      ...mockExtractRefreshTask,
      id: `task-${i}`,
    }));
    mocks.mockListExtractRefreshTasks.mockResolvedValue(tasks);
    const result = await getToolResult({ pageSize: 10, limit: 2 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed).toHaveLength(2);
  });

  describe('MAX_RESULT_LIMIT', () => {
    const fiveTasks = Array.from({ length: 5 }, (_, i) => ({
      ...mockExtractRefreshTask,
      id: `task-${i}`,
    }));

    afterEach(() => {
      vi.unstubAllEnvs();
      stubDefaultEnvVars();
    });

    async function getTaskIds(args: Record<string, unknown> = {}): Promise<Array<string>> {
      mocks.mockListExtractRefreshTasks.mockResolvedValue(fiveTasks);
      const result = await getToolResult(args);
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      return JSON.parse(result.content[0].text).map((task: { id: string }) => task.id);
    }

    it('caps results at the global MAX_RESULT_LIMIT', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '2');
      expect(await getTaskIds()).toEqual(['task-0', 'task-1']);
    });

    it('caps results at a tool-specific MAX_RESULT_LIMITS entry', async () => {
      vi.stubEnv('MAX_RESULT_LIMITS', 'list-extract-refresh-tasks:3');
      expect(await getTaskIds()).toEqual(['task-0', 'task-1', 'task-2']);
    });

    it('lets the cap win over a larger limit or pageSize', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '2');
      expect(await getTaskIds({ limit: 4, pageSize: 4 })).toHaveLength(2);
    });

    it('lets a smaller limit win over the cap', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '3');
      expect(await getTaskIds({ limit: 1 })).toEqual(['task-0']);
    });

    it('applies the cap after the filter', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '1');
      expect(await getTaskIds({ filter: 'id:in:task-3|task-4' })).toEqual(['task-3']);
    });

    it('returns every task when the tool-specific limit is unbounded', async () => {
      vi.stubEnv('MAX_RESULT_LIMIT', '2');
      vi.stubEnv('MAX_RESULT_LIMITS', 'list-extract-refresh-tasks:*');
      expect(await getTaskIds()).toHaveLength(5);
    });
  });
});

async function getToolResult(args: any = {}): Promise<CallToolResult> {
  const listExtractRefreshTasksTool = getListExtractRefreshTasksTool(new WebMcpServer());
  const callback = await Provider.from(listExtractRefreshTasksTool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
