import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDeleteExtractRefreshTaskTool } from './deleteExtractRefreshTask.js';

const mocks = vi.hoisted(() => ({
  mockDeleteExtractRefreshTask: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      tasksMethods: {
        deleteExtractRefreshTask: mocks.mockDeleteExtractRefreshTask,
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

describe('deleteExtractRefreshTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
    mocks.mockDeleteExtractRefreshTask.mockResolvedValue(undefined);
  });

  it('should create a tool instance with correct properties', () => {
    const deleteExtractRefreshTaskTool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
    expect(deleteExtractRefreshTaskTool.name).toBe('delete-extract-refresh-task');
    expect(deleteExtractRefreshTaskTool.description).toContain(
      'Deletes an extract refresh task from the Tableau site',
    );
    expect(deleteExtractRefreshTaskTool.paramsSchema).toHaveProperty('taskId');
  });

  it('should have correct annotations for destructive operation', () => {
    const deleteExtractRefreshTaskTool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
    expect(deleteExtractRefreshTaskTool.annotations).toEqual({
      title: 'Delete Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('should successfully delete an extract refresh task', async () => {
    const result = await getToolResult({ taskId: 'task-123' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('task-123');
    expect(result.content[0].text).toContain('successfully deleted');
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: 'task-123',
    });
  });

  it('should call assertAdmin before deleting', async () => {
    await getToolResult({ taskId: 'task-123' });
    expect(mocks.mockAssertAdmin).toHaveBeenCalled();
  });

  it('should fail when user is not admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValue({
      isErr: () => true,
      error: 'User is not a site administrator',
    });
    const result = await getToolResult({ taskId: 'task-123' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not a site administrator');
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Task not found';
    mocks.mockDeleteExtractRefreshTask.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ taskId: 'nonexistent-task' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });
});

async function getToolResult(args: { taskId: string }): Promise<CallToolResult> {
  const deleteExtractRefreshTaskTool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(deleteExtractRefreshTaskTool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
