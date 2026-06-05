import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { mockExtractRefreshTask } from '../extractRefreshTasks/mockExtractRefreshTask.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListSchedulesTool } from './listSchedules.js';

const mocks = vi.hoisted(() => ({
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

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

describe('listSchedulesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListSchedulesTool(new WebMcpServer());
    expect(tool.name).toBe('list-schedules');
    expect(tool.description).toContain('Retrieves the list of schedules');
    expect(tool.paramsSchema).toHaveProperty('filter');
    expect(tool.paramsSchema).toHaveProperty('pageSize');
    expect(tool.paramsSchema).toHaveProperty('limit');
  });

  it('should aggregate schedules from tasks', async () => {
    mocks.mockListExtractRefreshTasks.mockResolvedValue([
      mockExtractRefreshTask,
      { ...mockExtractRefreshTask, id: 'task-456', datasource: { id: 'datasource-def' } },
    ]);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('schedule-xyz');
    expect(parsed[0].taskCount).toBe(2);
    expect(parsed[0].datasourceIds.sort()).toEqual(['datasource-abc', 'datasource-def']);
  });

  it('should return empty message when no tasks are found', async () => {
    mocks.mockListExtractRefreshTasks.mockResolvedValue([]);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      'No schedules were found. Either none exist or you do not have permission to view them.',
    );
  });

  it('should apply a client-side filter', async () => {
    mocks.mockListExtractRefreshTasks.mockResolvedValue([
      mockExtractRefreshTask,
      {
        ...mockExtractRefreshTask,
        id: 'task-weekly',
        schedule: { id: 'schedule-weekly', frequency: 'Weekly' },
      },
    ]);
    const result = await getToolResult({ filter: 'frequency:eq:Weekly' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(`${result.content[0].text}`);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('schedule-weekly');
  });

  it('should apply a client-side limit', async () => {
    mocks.mockListExtractRefreshTasks.mockResolvedValue([
      { ...mockExtractRefreshTask, id: 't1', schedule: { id: 's1' } },
      { ...mockExtractRefreshTask, id: 't2', schedule: { id: 's2' } },
      { ...mockExtractRefreshTask, id: 't3', schedule: { id: 's3' } },
    ]);
    const result = await getToolResult({ limit: 2 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(`${result.content[0].text}`)).toHaveLength(2);
  });

  it('should error when the user is not an admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValue({
      isErr: () => true,
      error: 'This tool requires site administrator permissions.',
    });
    mocks.mockListExtractRefreshTasks.mockResolvedValue([mockExtractRefreshTask]);
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('site administrator');
  });

  it('should reject an invalid filter', async () => {
    mocks.mockListExtractRefreshTasks.mockResolvedValue([mockExtractRefreshTask]);
    const result = await getToolResult({ filter: 'bogus:eq:x' });
    expect(result.isError).toBe(true);
  });

  it('should handle API errors gracefully', async () => {
    mocks.mockListExtractRefreshTasks.mockRejectedValue(new Error('API Error'));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('API Error');
  });
});

async function getToolResult(args: any = {}): Promise<CallToolResult> {
  const tool = getListSchedulesTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
