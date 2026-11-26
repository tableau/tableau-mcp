import { CallToolResult } from '@modelcontextprotocol/server';
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
import { createAppApprovalEvidence } from '../_lib/appApproval.js';
import { auditRecordSchema } from '../_lib/auditRecord.js';
import { EvidenceContext } from '../_lib/evidence.js';
import { extractRefreshScheduleState } from '../_lib/resolveExtractRefreshTaskTarget.js';
import { exportedForTesting as signedTokenTesting } from '../_lib/signedTokenEvidence.js';
import { mutationTokenConfigFromEnv } from '../_lib/signedTokenEvidence.mock.js';
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
  mockListExtractRefreshTasks: vi.fn(),
  mockQueryDatasource: vi.fn(),
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
        listExtractRefreshTasks: mocks.mockListExtractRefreshTasks,
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
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
    ...mutationTokenConfigFromEnv(),
    adminToolsEnabled: true,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

// The signed app-approval token the last mintApproval() produced — what the iframe would read from
// the preview result's `_meta` and pass back as `approvalToken`. getToolResult() sends it.
let approvalToken: string | undefined;

async function mintApproval(namespace: string, ctx: EvidenceContext): Promise<void> {
  const evidence = createAppApprovalEvidence(namespace);
  await evidence.establish(ctx);
  approvalToken = evidence.getEstablishedNonce();
}

// Mirrors what the update-cloud preview does flag-ON: records an app approval bound to the previewed
// schedule. `schedule` defaults to validSchedule so callers exercising the happy path bind the same
// schedule they later confirm; a swap test passes a different schedule to prove the binding rejects.
// `state` is the task's schedule hash at preview time (the preview binds it; '' when the listed task
// carries no schedule, which is the default list mock).
async function establishApproval(
  taskId: string,
  schedule: UpdateCloudExtractRefreshSchedule = validSchedule,
  state = '',
): Promise<void> {
  await mintApproval('update-cloud-extract-refresh-task', {
    restApi: { siteId: 'test-site-id' } as never,
    siteId: 'test-site-id',
    target: { id: taskId, kind: 'extract-refresh-task', state },
    tool: 'confirm-update-cloud-extract-refresh-task',
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
    binding: scheduleBinding(schedule),
  });
}

describe('confirmUpdateCloudExtractRefreshTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    approvalToken = undefined;
    signedTokenTesting.reset();
    vi.stubEnv('MUTATION_PREVIEW_TTL_MINUTES', undefined);
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({
      id: 'owner-1',
      name: 'Owner One',
      email: 'owner@example.com',
      siteRole: 'SiteAdministratorCreator',
    });
    mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(new Ok(updatedTask));
    // Default: the task list resolves this task to its underlying datasource so the audit target is
    // enriched (AC-3).
    mocks.mockListExtractRefreshTasks.mockResolvedValue([
      { id: validTaskId, datasource: { id: 'ds-1' } },
    ]);
    mocks.mockQueryDatasource.mockResolvedValue({
      id: 'ds-1',
      name: 'Sales Extract',
      project: { name: 'Finance' },
      owner: { id: 'owner-1' },
    });
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  it('is a model-invisible app-only tool gated on admin-tools enablement && mcp-apps', () => {
    const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.name).toBe('confirm-update-cloud-extract-refresh-task');
    expect(tool.meta).toEqual({ ui: { visibility: ['app'] } });
    expect(tool.paramsSchema).toHaveProperty('taskId');
    expect(tool.paramsSchema).toHaveProperty('schedule');
  });

  it('is disabled when admin tools are not enabled', async () => {
    mocks.mockIsFeatureEnabled.mockImplementation(
      async (featureName: string) => featureName === 'mcp-apps',
    );
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({ adminToolsEnabled: false } as ReturnType<
      typeof getConfig
    >);
    const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is enabled when ADMIN_TOOLS_ENABLED, admin-tools, and mcp-apps are all on', async () => {
    mocks.mockIsFeatureEnabled.mockImplementation(
      async (featureName: string) => featureName === 'admin-tools' || featureName === 'mcp-apps',
    );
    const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is enabled when only the admin-tools flag is on (ADMIN_TOOLS_ENABLED off) and mcp-apps is on', async () => {
    // beforeEach leaves the admin-tools and mcp-apps flags on; only the env var is turned off here.
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({ adminToolsEnabled: false } as ReturnType<
      typeof getConfig
    >);
    const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is enabled when only ADMIN_TOOLS_ENABLED is on (admin-tools flag off) and mcp-apps is on', async () => {
    mocks.mockIsFeatureEnabled.mockImplementation(
      async (featureName: string) => featureName === 'mcp-apps',
    );
    const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
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
    expect(records.every((r) => r.confirmationEvidence.kind === 'signed-token')).toBe(true);
    // AC-3 / Gap-B: the audit target is enriched from the task's underlying datasource.
    expect(records[0].target.name).toBe('Sales Extract');
    expect(records[0].target.project).toBe('Finance');
    expect(records[0].target.owner).toBe('owner@example.com');
  });

  // The approval token binds the task's schedule at preview time; the confirm re-reads it.
  describe('schedule pre-state binding', () => {
    const currentSchedule = {
      frequency: 'Daily',
      frequencyDetails: { start: '02:00:00', intervals: { interval: { weekDay: 'Monday' } } },
    };

    beforeEach(() => {
      mocks.mockListExtractRefreshTasks.mockResolvedValue([
        { id: validTaskId, datasource: { id: 'ds-1' }, schedule: currentSchedule },
      ]);
    });

    it('applies when the task schedule is unchanged since the preview', async () => {
      await establishApproval(
        validTaskId,
        validSchedule,
        extractRefreshScheduleState(currentSchedule),
      );
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(false);
      expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledOnce();
    });

    it('rejects when the task schedule changed after the preview', async () => {
      await establishApproval(
        validTaskId,
        validSchedule,
        extractRefreshScheduleState(currentSchedule),
      );
      mocks.mockListExtractRefreshTasks.mockResolvedValue([
        {
          id: validTaskId,
          datasource: { id: 'ds-1' },
          schedule: { ...currentSchedule, frequency: 'Weekly' },
        },
      ]);
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('The target changed after the preview');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('fails closed when the confirm cannot read the task schedule', async () => {
      await establishApproval(
        validTaskId,
        validSchedule,
        extractRefreshScheduleState(currentSchedule),
      );
      mocks.mockListExtractRefreshTasks.mockRejectedValue(
        new Error('401 missing tableau:tasks:read'),
      );
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(true);
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    // W-25002517: a token consented before this tool required tableau:tasks:read.
    it.each([401, 403])(
      'names tableau:tasks:read and says to reconnect when the schedule re-read is refused (%i)',
      async (status) => {
        await establishApproval(
          validTaskId,
          validSchedule,
          extractRefreshScheduleState(currentSchedule),
        );
        mocks.mockListExtractRefreshTasks.mockRejectedValue(makeHttpError(status));
        const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain(
          "Could not read this extract refresh task's current schedule to prepare the confirmation (requires tableau:tasks:read)",
        );
        expect(result.content[0].text).toContain('Reconnect Tableau');
        expect(result.content[0].text).not.toContain('Permission denied');
        expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
        const record = getAuditRecord();
        expect(record.result).toBe('denied');
        expect(record.denyReason).toBe('confirmation-pre-state-forbidden');
      },
    );
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
    await mintApproval('delete-content', {
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
    // A rejected schedule-swap must not burn the approval token; the correct schedule still works.
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

  // --- Signed app-approval token: cross-replica, secret-bound, model-visible text never involved ---

  it('applies on a second replica sharing MUTATION_TOKEN_SECRET (fresh keys + replay cache)', async () => {
    vi.stubEnv('MUTATION_TOKEN_SECRET', 'app-approval-replica-secret-0123456789ab');
    signedTokenTesting.reset();
    await establishApproval(validTaskId);
    signedTokenTesting.reset();
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(false);
    expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it('rejects an approval token minted under a different secret', async () => {
    vi.stubEnv('MUTATION_TOKEN_SECRET', 'app-approval-replica-secret-0123456789ab');
    signedTokenTesting.reset();
    await establishApproval(validTaskId);
    vi.stubEnv('MUTATION_TOKEN_SECRET', 'a-completely-different-secret-0123456789');
    signedTokenTesting.reset();
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(true);
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('rejects a model-visible confirmation token offered as the approval token (separate key)', async () => {
    const { SignedTokenEvidence } = await import('../_lib/signedTokenEvidence.js');
    const confirmation = new SignedTokenEvidence({
      namespace: 'update-cloud-extract-refresh-task',
    });
    await confirmation.establish({
      restApi: { siteId: 'test-site-id' } as never,
      siteId: 'test-site-id',
      target: { id: validTaskId, kind: 'extract-refresh-task' },
      tool: 'confirm-update-cloud-extract-refresh-task',
      userLuid: getMockRequestHandlerExtra().getUserLuid(),
      binding: scheduleBinding(validSchedule),
    });
    const result = await getToolResult({
      taskId: validTaskId,
      schedule: validSchedule,
      approvalToken: confirmation.getEstablishedNonce(),
    });
    expect(result.isError).toBe(true);
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
  });

  // --- Same-replica replay ---

  it('same-replica replay: applies once then a replay is rejected', async () => {
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
      // The signed approval token expires after the default 5-minute window; advance past it so the
      // codec rejects it as expired before the confirm applies anything.
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
  approvalToken?: string;
}): Promise<CallToolResult> {
  const tool = getConfirmUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      taskId: args.taskId,
      schedule: args.schedule,
      approvalToken: args.approvalToken ?? approvalToken,
    },
    getMockRequestHandlerExtra(),
  );
}

function makeHttpError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}
