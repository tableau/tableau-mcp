import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import {
  ExtractRefreshTask,
  UpdateCloudExtractRefreshSchedule,
} from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { auditRecordSchema } from '../_lib/auditRecord.js';
import { AppApprovalEvidence } from '../_lib/evidence.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getConfirmUpdateCloudExtractRefreshTaskTool } from './confirmUpdateCloudExtractRefreshTask.js';
import { scheduleBinding } from './updateCloudExtractRefreshTask.js';

vi.mock('../../../logging/logger.js');

// All mutation-audit records emitted so far, each parsed through the authoritative schema so the
// assertion fails if the guard ever drops a required field. A confirmed update emits exactly one
// terminal record (completed or failed); denied paths also emit exactly one.
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

const validSchedule: UpdateCloudExtractRefreshSchedule = {
  frequency: 'Weekly',
  frequencyDetails: {
    start: '06:00:00',
    intervals: { interval: [{ weekDay: 'Sunday' }] },
  },
};

const updatedTask: ExtractRefreshTask = {
  id: validTaskId,
  type: 'RefreshExtractTask',
  schedule: {
    frequency: 'Weekly',
    frequencyDetails: { start: '06:00:00', intervals: { interval: [{ weekDay: 'Sunday' }] } },
  },
};

const mocks = vi.hoisted(() => ({
  mockUpdateCloudExtractRefreshTask: vi.fn(),
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
        updateCloudExtractRefreshTask: mocks.mockUpdateCloudExtractRefreshTask,
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

// Mirrors what the update-cloud preview does flag-ON: records an app approval bound to the previewed
// schedule. `schedule` defaults to validSchedule so callers exercising the happy path bind the same
// schedule they later confirm; a swap test passes a different schedule to prove the binding rejects.
async function establishApproval(
  taskId: string,
  schedule: UpdateCloudExtractRefreshSchedule = validSchedule,
): Promise<void> {
  await new AppApprovalEvidence('update-cloud-extract-refresh-task').establish({
    restApi: { siteId: 'test-site-id' } as never,
    siteId: 'test-site-id',
    target: { id: taskId, kind: 'extract-refresh-task' },
    tool: 'confirm-update-cloud-extract-refresh-task',
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
    binding: scheduleBinding(schedule),
  });
}

describe('confirmUpdateCloudExtractRefreshTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
    mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(new Ok(updatedTask));
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  it('is a model-invisible app-only tool gated on adminToolsEnabled && mcp-apps', () => {
    const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.name).toBe('confirm-update-cloud-extract-refresh-task');
    expect(tool.meta).toEqual({ ui: { visibility: ['app'] } });
    expect(tool.paramsSchema).toHaveProperty('taskId');
    expect(tool.paramsSchema).toHaveProperty('schedule');
  });

  it('is disabled when admin tools are not enabled', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({ adminToolsEnabled: false } as ReturnType<
      typeof getConfig
    >);
    const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is disabled when the mcp-apps flag is OFF', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  // --- Happy path: approval present → applies the schedule change once ---

  it('applies the schedule change when a human approval was recorded by the preview', async () => {
    await establishApproval(validTaskId);
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('successfully updated');
    expect(result.content[0].text).toContain('Weekly');
    expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: validTaskId,
      schedule: validSchedule,
    });
    // A confirmed update emits exactly one record: the terminal 'completed' outcome once the REST
    // update succeeds (the confirm's authorization is folded into that terminal record).
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['completed']);
    expect(records.every((r) => r.phase === 'confirm')).toBe(true);
    expect(records.every((r) => r.action === 'update')).toBe(true);
    expect(records.every((r) => r.confirmationEvidence.kind === 'registry-nonce')).toBe(true);
  });

  // --- Missing approval → PreviewNotRunError, no update ---

  it('rejects with PreviewNotRunError when no human approval was recorded', async () => {
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('preview-not-run');
  });

  // --- Cross-namespace isolation: a delete approval must not unlock an update ---

  it('rejects an approval established under the delete-content namespace', async () => {
    await new AppApprovalEvidence('delete-content').establish({
      restApi: { siteId: 'test-site-id' } as never,
      siteId: 'test-site-id',
      target: { id: validTaskId, kind: 'extract-refresh-task' },
      tool: 'delete-content',
      userLuid: getMockRequestHandlerExtra().getUserLuid(),
    });
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(true);
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
  });

  // --- Schedule binding: approve schedule A, confirm schedule B → rejected, no update ---

  it('rejects when the confirm carries a different schedule than the one approved (no schedule swap)', async () => {
    // The human approved validSchedule (Weekly/Sunday/06:00) in the preview panel. A client that then
    // confirms a DIFFERENT schedule must be rejected — the approval is bound to the previewed schedule.
    await establishApproval(validTaskId, validSchedule);
    const swappedSchedule: UpdateCloudExtractRefreshSchedule = {
      frequency: 'Weekly',
      frequencyDetails: {
        start: '09:00:00',
        intervals: { interval: [{ weekDay: 'Monday' }] },
      },
    };
    const result = await getToolResult({ taskId: validTaskId, schedule: swappedSchedule });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Mutation blocked');
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    expect(getAuditRecord().denyReason).toBe('preview-not-run');
  });

  it('a mismatched-schedule confirm does not consume the genuine approval', async () => {
    // A rejected schedule-swap must not burn the single-use approval; the correct schedule still works.
    await establishApproval(validTaskId, validSchedule);
    const swappedSchedule: UpdateCloudExtractRefreshSchedule = {
      frequency: 'Weekly',
      frequencyDetails: { start: '09:00:00', intervals: { interval: [{ weekDay: 'Monday' }] } },
    };
    const swapped = await getToolResult({ taskId: validTaskId, schedule: swappedSchedule });
    expect(swapped.isError).toBe(true);
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();

    vi.mocked(logger.log).mockClear();
    const genuine = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(genuine.isError).toBe(false);
    expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledTimes(1);
  });

  // --- Single-use ---

  it('single-use: applies once then a replay is rejected', async () => {
    await establishApproval(validTaskId);
    const first = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(first.isError).toBe(false);
    expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledTimes(1);

    vi.mocked(logger.log).mockClear();
    const second = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(second.isError).toBe(true);
    expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledTimes(1);
  });

  // --- Expired approval window: TTL elapsed → rejected, no update ---

  describe('expired approval window', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('rejects when the human approval has expired (TTL elapsed) and performs no update', async () => {
      await establishApproval(validTaskId);
      // The approval auto-expires after the default 5-minute window; advance past it so the shared
      // AppApprovalEvidence cache has dropped the entry before the confirm verifies it.
      await vi.advanceTimersByTimeAsync(1000 * 60 * 6);
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Mutation blocked');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
      expect(getAuditRecord().denyReason).toBe('preview-not-run');
    });
  });

  // --- AuthZ ---

  it('rejects and performs no update when the user is not an admin', async () => {
    await establishApproval(validTaskId);
    mocks.mockAssertAdmin.mockResolvedValue(new Err('not admin'));
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(true);
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    expect(getAuditRecord().denyReason).toBe('not-admin');
  });

  // --- Error path: Tableau-structured error surfaced (approval already consumed before the call) ---

  it('surfaces a Tableau 404 Cloud-only hint when the update fails', async () => {
    await establishApproval(validTaskId);
    mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(
      new Err({ type: 'tableau-api', status: 404, code: '404001', summary: 'Resource not found' }),
    );
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Tableau Cloud only');
    expect(result.content[0].text).toContain('Tableau 404 [404001]');
    // An authorized-but-failed update records the terminal 'failed' outcome (with the Tableau-api
    // detail) as the sole confirm record, so the audit trail never claims an update that did not
    // happen.
    const records = getAuditRecords();
    expect(records.map((r) => r.result)).toEqual(['failed']);
    const failed = records.find((r) => r.result === 'failed');
    invariant(failed, 'expected a failed audit record');
    expect(failed.failureDetail).toContain('Tableau 404 [404001]');
  });
});

async function getToolResult(args: {
  taskId: string;
  schedule: UpdateCloudExtractRefreshSchedule;
}): Promise<CallToolResult> {
  const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { taskId: args.taskId, schedule: args.schedule },
    getMockRequestHandlerExtra(),
  );
}
