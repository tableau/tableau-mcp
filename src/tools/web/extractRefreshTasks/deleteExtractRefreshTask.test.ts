import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDeleteExtractRefreshTaskTool } from './deleteExtractRefreshTask.js';
import { computeConfirmationToken } from './updateCloudExtractRefreshTask.js';

const validTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';
const validToken = computeConfirmationToken('test-site-id', validTaskId);

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
    expect(deleteExtractRefreshTaskTool.paramsSchema).toHaveProperty('confirm');
    expect(deleteExtractRefreshTaskTool.paramsSchema).toHaveProperty('confirmationToken');
  });

  it('should have correct annotations for destructive operation', () => {
    const deleteExtractRefreshTaskTool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
    expect(deleteExtractRefreshTaskTool.annotations).toEqual({
      title: 'Delete Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
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

  it('should fail when user is not admin and not call delete', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(
      new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
    );
    const result = await getToolResult({ taskId: 'task-123' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires site administrator permissions');
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'Task not found';
    mocks.mockDeleteExtractRefreshTask.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ taskId: 'nonexistent-task' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('two-phase contract', () => {
    it('returns a preview without calling Tableau when confirm is omitted', async () => {
      const result = await getToolResult({ taskId: validTaskId, confirm: false });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Preview');
      expect(result.content[0].text).toContain(validTaskId);
      // Token is the deterministic sha256(siteId:taskId)[0..12].
      expect(result.content[0].text).toContain(validToken);
      expect(result.content[0].text).toContain('confirm: true and confirmationToken');
      // No Tableau call in the preview phase — admin gate runs but the delete endpoint does not.
      expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('still runs the admin gate in the preview phase', async () => {
      mocks.mockAssertAdmin.mockResolvedValue(
        new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
      );
      const result = await getToolResult({ taskId: validTaskId, confirm: false });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('requires site administrator permissions');
      expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('rejects apply with a missing confirmationToken and never calls Tableau', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        confirm: true,
        confirmationToken: undefined,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('confirmationToken returned by the preview step');
      expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('rejects apply with a mismatched confirmationToken and never calls Tableau', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        confirm: true,
        confirmationToken: 'deadbeefcafe',
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('confirmationToken returned by the preview step');
      expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('deletes when confirm is true and the confirmationToken matches', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        confirm: true,
        confirmationToken: validToken,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('successfully deleted');
      expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledTimes(1);
    });

    it('emits the same deterministic token across preview calls', async () => {
      const first = await getToolResult({ taskId: validTaskId, confirm: false });
      const second = await getToolResult({ taskId: validTaskId, confirm: false });
      invariant(first.content[0].type === 'text');
      invariant(second.content[0].type === 'text');
      expect(first.content[0].text).toContain(validToken);
      expect(second.content[0].text).toContain(validToken);
    });
  });
});

async function getToolResult(args: {
  taskId: string;
  confirm?: boolean;
  confirmationToken?: string;
}): Promise<CallToolResult> {
  const deleteExtractRefreshTaskTool = getDeleteExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(deleteExtractRefreshTaskTool.callback);
  // Default to the apply path (confirm: true + matching token) so existing one-call-style tests
  // continue to exercise the destructive code path. Two-phase / preview tests opt out explicitly
  // by passing `confirm: false` or a wrong token. The `'confirmationToken' in args` check matters
  // because `??` would treat an explicit `undefined` the same as omitted and silently inject a
  // valid token, masking the missing-token rejection test.
  const resolved = {
    ...args,
    confirm: args.confirm ?? true,
    confirmationToken:
      'confirmationToken' in args
        ? args.confirmationToken
        : computeConfirmationToken('test-site-id', args.taskId),
  };
  return await callback(resolved, getMockRequestHandlerExtra());
}
