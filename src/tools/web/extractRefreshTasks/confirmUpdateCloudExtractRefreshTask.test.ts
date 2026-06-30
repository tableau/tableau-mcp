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

vi.mock('../../../logging/logger.js');

function getAuditRecord(): ReturnType<typeof auditRecordSchema.parse> {
  const log = logger.log as MockedFunction<typeof logger.log>;
  const auditEntries = log.mock.calls.map((c) => c[0]).filter((e) => e.logger === 'audit');
  expect(auditEntries).toHaveLength(1);
  return auditRecordSchema.parse(auditEntries[0].data);
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

vi.mock('../../../features/featureGate.js', () => ({
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

async function establishApproval(taskId: string): Promise<void> {
  await new AppApprovalEvidence('update-cloud-extract-refresh-task').establish({
    restApi: { siteId: 'test-site-id' } as never,
    siteId: 'test-site-id',
    target: { id: taskId, kind: 'extract-refresh-task' },
    tool: 'confirm-update-cloud-extract-refresh-task',
    userLuid: getMockRequestHandlerExtra().getUserLuid(),
  });
}

describe('confirmUpdateCloudExtractRefreshTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MUTATION_PREVIEW_TTL_MINUTES;
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
    mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(new Ok(updatedTask));
    mocks.mockIsFeatureEnabled.mockReturnValue(true);
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
    mocks.mockIsFeatureEnabled.mockReturnValue(false);
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
    const record = getAuditRecord();
    expect(record.result).toBe('allowed');
    expect(record.phase).toBe('confirm');
    expect(record.action).toBe('update');
    expect(record.confirmationEvidence.kind).toBe('registry-nonce');
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

  it('rejects an approval established under the delete-extract-refresh-task namespace', async () => {
    await new AppApprovalEvidence('delete-extract-refresh-task').establish({
      restApi: { siteId: 'test-site-id' } as never,
      siteId: 'test-site-id',
      target: { id: validTaskId, kind: 'extract-refresh-task' },
      tool: 'confirm-delete-extract-refresh-task',
      userLuid: getMockRequestHandlerExtra().getUserLuid(),
    });
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(true);
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
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
