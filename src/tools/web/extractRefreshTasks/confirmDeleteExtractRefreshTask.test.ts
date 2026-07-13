import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { auditRecordSchema } from '../_lib/auditRecord.js';
import { AppApprovalEvidence } from '../_lib/evidence.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getConfirmDeleteExtractRefreshTaskTool } from './confirmDeleteExtractRefreshTask.js';

vi.mock('../../../logging/logger.js');

// All mutation-audit records emitted so far, each parsed through the authoritative schema so the
// assertion fails if the guard ever drops a required field. A confirmed delete emits two (the
// allowed authorization decision, then the terminal completed/failed outcome); denied paths emit one.
function getAuditRecords(): ReturnType<typeof auditRecordSchema.parse>[] {
  const log = logger.log as MockedFunction<typeof logger.log>;
  return log.mock.calls
    .map((c) => c[0])
    .filter((e) => e.logger === 'audit')
    .map((e) => auditRecordSchema.parse(e.data));
}

// Convenience for the single-audit-record assertions (denied paths emit exactly one).
function getAuditRecord(): ReturnType<typeof auditRecordSchema.parse> {
  const records = getAuditRecords();
  expect(records).toHaveLength(1);
  return records[0];
}

const validTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';

const mocks = vi.hoisted(() => ({
  mockDeleteExtractRefreshTask: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
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

// Records a genuine in-iframe human approval under the SAME namespace the preview tool establishes.
async function establishApproval(taskId: string): Promise<void> {
  await new AppApprovalEvidence('delete-extract-refresh-task').establish({
    restApi: { siteId: 'test-site-id' } as never,
    siteId: 'test-site-id',
    target: { id: taskId, kind: 'extract-refresh-task' },
    tool: 'confirm-delete-extract-refresh-task',
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
  });
}

describe('confirmDeleteExtractRefreshTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
    mocks.mockDeleteExtractRefreshTask.mockResolvedValue(undefined);
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  it('is a model-invisible app-only tool gated on adminToolsEnabled && mcp-apps', async () => {
    const tool = getConfirmDeleteExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.name).toBe('confirm-delete-extract-refresh-task');
    expect(tool.meta).toEqual({ ui: { visibility: ['app'] } });
    expect(tool.paramsSchema).toHaveProperty('taskId');
    expect((await Provider.from(tool.annotations))?.destructiveHint).toBe(true);
  });

  it('is disabled when admin tools are not enabled', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({ adminToolsEnabled: false } as ReturnType<
      typeof getConfig
    >);
    const tool = getConfirmDeleteExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is disabled when the mcp-apps flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getConfirmDeleteExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('rejects a non-UUID taskId at the schema boundary', () => {
    const tool = getConfirmDeleteExtractRefreshTaskTool(new WebMcpServer());
    const taskIdSchema = (
      tool.paramsSchema as { taskId: { safeParse: (v: unknown) => { success: boolean } } }
    ).taskId;
    expect(taskIdSchema.safeParse('task-123').success).toBe(false);
    expect(taskIdSchema.safeParse(validTaskId).success).toBe(true);
  });

  // --- Happy path: approval present → deletes once ---

  it('deletes the task when a human approval was recorded by the preview', async () => {
    await establishApproval(validTaskId);
    const result = await getToolResult({ taskId: validTaskId });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('successfully deleted');
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledTimes(1);
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: validTaskId,
    });
    // A confirmed delete emits two records: the allowed authorization decision, then the terminal
    // 'completed' outcome once the REST delete succeeds (audit reflects outcome, not just intent).
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['allowed', 'completed']);
    expect(records.every((r) => r.phase === 'confirm')).toBe(true);
    expect(records.every((r) => r.confirmationEvidence.kind === 'registry-nonce')).toBe(true);
  });

  // --- Missing approval → PreviewNotRunError, no delete ---

  it('rejects with PreviewNotRunError when no human approval was recorded', async () => {
    const result = await getToolResult({ taskId: validTaskId });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('preview-not-run');
  });

  // --- Cross-namespace isolation through the tool ---

  it('rejects an approval established under a DIFFERENT tool namespace (no cross-tool unlock)', async () => {
    // Establish under delete-datasource's namespace for the same id; the delete-extract-refresh-task
    // confirm must NOT be satisfied by it.
    await new AppApprovalEvidence('delete-datasource').establish({
      restApi: { siteId: 'test-site-id' } as never,
      siteId: 'test-site-id',
      target: { id: validTaskId, kind: 'extract-refresh-task' },
      tool: 'confirm-delete-datasource',
      userLuid: getMockRequestHandlerExtra().getUserLuid(),
    });
    const result = await getToolResult({ taskId: validTaskId });
    expect(result.isError).toBe(true);
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
  });

  // --- Single-use ---

  it('single-use: deletes once then a replay is rejected', async () => {
    await establishApproval(validTaskId);
    const first = await getToolResult({ taskId: validTaskId });
    expect(first.isError).toBe(false);
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledTimes(1);

    vi.mocked(logger.log).mockClear();
    const second = await getToolResult({ taskId: validTaskId });
    expect(second.isError).toBe(true);
    expect(mocks.mockDeleteExtractRefreshTask).toHaveBeenCalledTimes(1);
  });

  // --- Expired approval window: TTL elapsed → rejected, no delete ---

  describe('expired approval window', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects when the human approval has expired (TTL elapsed) and performs no delete', async () => {
      await establishApproval(validTaskId);
      // The approval auto-expires after the default 5-minute window; advance past it so the shared
      // AppApprovalEvidence cache has dropped the entry before the confirm verifies it.
      await vi.advanceTimersByTimeAsync(1000 * 60 * 6);
      const result = await getToolResult({ taskId: validTaskId });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Mutation blocked');
      expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
      expect(getAuditRecord().denyReason).toBe('preview-not-run');
    });
  });

  // --- AuthZ ---

  it('rejects and performs no delete when the user is not an admin', async () => {
    await establishApproval(validTaskId);
    mocks.mockAssertAdmin.mockResolvedValue(new Err('not admin'));
    const result = await getToolResult({ taskId: validTaskId });
    expect(result.isError).toBe(true);
    expect(mocks.mockDeleteExtractRefreshTask).not.toHaveBeenCalled();
    expect(getAuditRecord().denyReason).toBe('not-admin');
  });

  // --- Error path on the destructive call ---

  it('surfaces a delete API error', async () => {
    await establishApproval(validTaskId);
    mocks.mockDeleteExtractRefreshTask.mockRejectedValue(new Error('Task not found'));
    const result = await getToolResult({ taskId: validTaskId });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Task not found');
    // An authorized-but-failed delete records the terminal 'failed' outcome (with detail) so the
    // audit trail never claims a deletion that did not happen.
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['allowed', 'failed']);
    const failed = records.find((r) => r.result === 'failed');
    invariant(failed, 'expected a failed audit record');
    expect(failed.failureDetail).toContain('Task not found');
  });
});

async function getToolResult(args: { taskId: string }): Promise<CallToolResult> {
  const tool = getConfirmDeleteExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ taskId: args.taskId }, getMockRequestHandlerExtra());
}
