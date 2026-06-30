import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import {
  ExtractRefreshTask,
  UpdateCloudExtractRefreshSchedule,
  updateCloudExtractRefreshScheduleSchema,
} from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { auditRecordSchema } from '../_lib/auditRecord.js';
import { AppApprovalEvidence } from '../_lib/evidence.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getUpdateCloudExtractRefreshTaskTool } from './updateCloudExtractRefreshTask.js';

// Auto-mock the logger so the durable audit record emitted by the mutation guard is captured as a
// spy call (AC-6) rather than written to stderr.
vi.mock('../../../logging/logger.js');

// Parse the single mutation-audit record emitted on this call through the authoritative schema so
// the assertion fails if the guard ever drops a required field. Returns the validated record.
function getAuditRecord(): ReturnType<typeof auditRecordSchema.parse> {
  const log = logger.log as MockedFunction<typeof logger.log>;
  const auditEntries = log.mock.calls.map((c) => c[0]).filter((e) => e.logger === 'audit');
  expect(auditEntries).toHaveLength(1);
  return auditRecordSchema.parse(auditEntries[0].data);
}

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

const validTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';

const validSchedule: UpdateCloudExtractRefreshSchedule = {
  frequency: 'Weekly',
  frequencyDetails: {
    start: '06:00:00',
    intervals: {
      interval: [{ weekDay: 'Sunday' }],
    },
  },
};

const updatedTask: ExtractRefreshTask = {
  id: validTaskId,
  type: 'RefreshExtractTask',
  schedule: {
    frequency: 'Weekly',
    frequencyDetails: {
      start: '06:00:00',
      intervals: { interval: [{ weekDay: 'Sunday' }] },
    },
  },
};

describe('updateCloudExtractRefreshTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ siteRole: 'SiteAdministratorCreator' });
    mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(new Ok(updatedTask));
    // Default: mcp-apps flag OFF → today's exact confirm-only behavior.
    mocks.mockIsFeatureEnabled.mockReturnValue(false);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.name).toBe('update-cloud-extract-refresh-task');
    expect(tool.description).toContain('Updates the schedule of an extract refresh task');
    expect(tool.paramsSchema).toHaveProperty('taskId');
    expect(tool.paramsSchema).toHaveProperty('schedule');
  });

  it('should have correct annotations', () => {
    const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.annotations).toEqual({
      title: 'Update Cloud Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('should be disabled when admin tools are not enabled', async () => {
    const { getConfig } = await import('../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({
      adminToolsEnabled: false,
    } as ReturnType<typeof getConfig>);
    const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('should successfully update an extract refresh task', async () => {
    const result = await getToolResult({
      taskId: validTaskId,
      schedule: validSchedule,
      confirm: true,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(validTaskId);
    expect(result.content[0].text).toContain('successfully updated');
    expect(result.content[0].text).toContain('Weekly');
    expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: validTaskId,
      schedule: validSchedule,
    });
  });

  it('should call assertAdmin before updating', async () => {
    await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(mocks.mockAssertAdmin).toHaveBeenCalled();
  });

  it('should fail when user is not admin and not call update', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(
      new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
    );
    const result = await getToolResult({
      taskId: validTaskId,
      schedule: validSchedule,
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires site administrator permissions');
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
  });

  // AC-6(c): a denied attempt still emits an authoritative audit record with required fields.
  it('should emit a DENIED audit record when the user is not an admin', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('not admin'));
    await getToolResult({ taskId: validTaskId, schedule: validSchedule, confirm: true });
    const record = getAuditRecord();
    expect(record.result).toBe('denied');
    expect(record.denyReason).toBe('not-admin');
    expect(record.tool).toBe('update-cloud-extract-refresh-task');
    expect(record.action).toBe('update');
    expect(record.confirmationEvidence.kind).toBe('none');
  });

  it('should surface Tableau-structured error code/summary/detail when present', async () => {
    mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(
      new Err({
        type: 'tableau-api',
        status: 409,
        code: '409004',
        summary: 'Conflict',
        detail: 'Invalid subscription schedule',
      }),
    );
    const result = await getToolResult({
      taskId: validTaskId,
      schedule: validSchedule,
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Tableau 409');
    expect(result.content[0].text).toContain('[409004]');
    expect(result.content[0].text).toContain('Conflict');
    expect(result.content[0].text).toContain('Invalid subscription schedule');
  });

  it('should fall back to a plain message when no Tableau error body is present', async () => {
    mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(
      new Err({ type: 'unknown', message: 'Network connection lost' }),
    );
    const result = await getToolResult({
      taskId: validTaskId,
      schedule: validSchedule,
      confirm: true,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Network connection lost');
  });

  it('should accept Hourly schedule with start and end window', async () => {
    const hourly: UpdateCloudExtractRefreshSchedule = {
      frequency: 'Hourly',
      frequencyDetails: {
        start: '08:00:00',
        end: '18:00:00',
        intervals: { interval: [{ hours: 2 }, { weekDay: 'Monday' }] },
      },
    };
    const result = await getToolResult({ taskId: validTaskId, schedule: hourly, confirm: true });
    expect(result.isError).toBe(false);
    expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: validTaskId,
      schedule: hourly,
    });
  });

  describe('schedule schema validation', () => {
    it('should accept Daily schedule without end (Tableau ignores it)', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Daily',
        frequencyDetails: {
          start: '06:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject non-zero-padded times', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Daily',
        frequencyDetails: { start: '6:00:00' },
      });
      expect(result.success).toBe(false);
    });

    it('should report only the format error (not the 5-minute-boundary error) for an unpadded time', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Daily',
        frequencyDetails: {
          start: '6:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const startErrors = result.error.issues.filter(
          (i) => i.path.join('.') === 'frequencyDetails.start',
        );
        // Only the regex/format error fires; isFiveMinuteBoundary short-circuits when the
        // format is invalid so callers see one root cause, not two messages.
        expect(startErrors).toHaveLength(1);
        expect(startErrors[0].message).toContain('HH:mm:ss');
      }
    });

    it('should reject start times not on a 5-minute boundary', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Daily',
        frequencyDetails: { start: '07:26:00' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('5-minute boundary');
      }
    });

    it('should reject non-zero seconds on the start time', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Daily',
        frequencyDetails: { start: '06:00:30' },
      });
      expect(result.success).toBe(false);
    });

    it('should reject Hourly schedule missing end', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Hourly',
        frequencyDetails: {
          start: '06:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('end is required for Hourly');
      }
    });

    it('should reject Hourly schedule with mismatched minute portions', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Hourly',
        frequencyDetails: {
          start: '06:00:00',
          end: '18:30:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('same minute');
      }
    });

    it('should reject Hourly schedule with end before start (numeric, not lexical)', () => {
      // '10:00:00' > '09:00:00' lexically but '09:00:00' is correctly the smaller value;
      // this guards against the lexical-string-compare bug that would wrongly accept the
      // inverse pair start='10:00:00', end='09:00:00'.
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Hourly',
        frequencyDetails: {
          start: '10:00:00',
          end: '09:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('strictly after');
      }
    });

    it('should accept Hourly schedule with valid 09:00–10:00 window', () => {
      // Lexical compare would say '10:00:00' < '09:00:00' (because '1' < '9'), wrongly
      // rejecting this valid pair. Numeric comparison keeps it accepted.
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Hourly',
        frequencyDetails: {
          start: '09:00:00',
          end: '10:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      });
      expect(result.success).toBe(true);
    });

    it('should reject Hourly schedule without a weekDay interval', () => {
      // Confirmed live: Tableau rejects with 409004 "Hourly and Daily schedules must
      // have at least one weekDay interval". Reject client-side to skip the round-trip.
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Hourly',
        frequencyDetails: {
          start: '08:00:00',
          end: '18:00:00',
          intervals: { interval: [{ hours: 2 }] },
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('weekDay');
      }
    });

    it('should reject Daily schedule without a weekDay interval', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Daily',
        frequencyDetails: { start: '06:00:00' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('weekDay');
      }
    });

    it('should reject Weekly schedule without a weekDay interval', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Weekly',
        frequencyDetails: { start: '06:00:00' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('weekDay');
      }
    });

    it('should reject Monthly schedule without a monthDay interval', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Monthly',
        frequencyDetails: { start: '06:00:00' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('monthDay');
      }
    });
  });

  describe('Tableau API error formatting', () => {
    it('should map a 404 to a Cloud-only hint and preserve the Tableau code', async () => {
      mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(
        new Err({
          type: 'tableau-api',
          status: 404,
          code: '404001',
          summary: 'Resource not found',
          detail: 'Task not found',
        }),
      );
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Tableau Cloud only');
      expect(result.content[0].text).toContain(validTaskId);
      // Code visibility is consistent with the generic branch — keeps debugability when
      // Tableau emits multiple 404 sub-codes (e.g. 404026 vs 404001).
      expect(result.content[0].text).toContain('Tableau 404 [404001]');
    });

    it('should not produce a double-colon when Tableau returns code without summary', async () => {
      mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(
        new Err({
          type: 'tableau-api',
          status: 409,
          code: '409004',
          detail: 'Invalid subscription schedule.',
        }),
      );
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).not.toContain(': :');
      expect(result.content[0].text).toContain(
        'Tableau 409 [409004]: Invalid subscription schedule.',
      );
    });
  });

  describe('success message fallbacks', () => {
    it('should use args.schedule for the time window when the response omits frequencyDetails', async () => {
      mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(
        new Ok({
          id: validTaskId,
          // schedule field present but frequencyDetails missing — common partial response.
          schedule: { frequency: 'Weekly' },
        } as ExtractRefreshTask),
      );
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Weekly');
      // Falls back to args.schedule.frequencyDetails.start.
      expect(result.content[0].text).toContain('06:00:00');
    });
  });

  // --- AC-6: confirm-only preview→confirm gate + audit on both phases ---

  describe('AC-6 confirm gate and audit', () => {
    it('AC-6(a): preview (confirm omitted) does NOT apply the update and audits an allowed preview', async () => {
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Preview');
      expect(result.content[0].text).toContain('No change has been made');
      // The gate is the confirm flag: with it omitted, the destructive update never runs.
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
      const record = getAuditRecord();
      expect(record.result).toBe('allowed');
      expect(record.phase).toBe('preview');
      expect(record.action).toBe('update');
      expect(record.confirmationEvidence.kind).toBe('none');
    });

    it('AC-6(b): confirm: true applies the update and audits an allowed confirm', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
      });
      expect(result.isError).toBe(false);
      expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalled();
      const record = getAuditRecord();
      expect(record.result).toBe('allowed');
      expect(record.phase).toBe('confirm');
      expect(record.action).toBe('update');
      expect(record.target.id).toBe(validTaskId);
    });
  });

  // --- MCP-Apps flag ON: preview carries the iframe app + records a human-approval window ---

  describe('with mcp-apps flag ON', () => {
    beforeEach(() => {
      mocks.mockIsFeatureEnabled.mockReturnValue(true);
    });

    it('carries the update-cloud-extract-refresh-task app config so the host renders the confirm iframe', () => {
      const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
      expect(tool.app).toBeDefined();
      expect(tool.app?.resourceUri).toContain('update-cloud-extract-refresh-task');
    });

    it('preview returns an AppToolResult panel payload AND records a single-use human approval', async () => {
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.data.kind).toBe('update-cloud-extract-refresh-task-confirm');
      expect(payload.data.taskId).toBe(validTaskId);
      expect(payload.data.schedule.frequency).toBe('Weekly');
      expect(typeof payload.data.expiresAtMs).toBe('number');
      // SECURITY: no secret/token is transported to the iframe — approval is presence-based.
      expect(result.content[0].text).not.toMatch(/nonce|token|secret/i);
      // The destructive update never runs during preview.
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();

      // The approval was recorded under the 'update-cloud-extract-refresh-task' namespace.
      const extra = getMockRequestHandlerExtra();
      await expect(
        new AppApprovalEvidence('update-cloud-extract-refresh-task').verify({
          restApi: { siteId: 'test-site-id' } as never,
          siteId: 'test-site-id',
          target: { id: validTaskId, kind: 'extract-refresh-task' },
          tool: 'confirm-update-cloud-extract-refresh-task',
          userLuid: extra.getUserLuid(),
        }),
      ).resolves.toBe(true);
    });

    it('routes confirm:true to the human-gesture panel instead of updating (no model self-confirm)', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('confirm-update-cloud-extract-refresh-task');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });
  });
});

async function getToolResult(args: {
  taskId: string;
  schedule: UpdateCloudExtractRefreshSchedule;
  confirm?: boolean;
}): Promise<CallToolResult> {
  const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { taskId: args.taskId, schedule: args.schedule, confirm: args.confirm },
    getMockRequestHandlerExtra(),
  );
}
