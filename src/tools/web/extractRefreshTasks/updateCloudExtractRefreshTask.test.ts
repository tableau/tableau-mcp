import { CallToolResult } from '@modelcontextprotocol/server';
import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import {
  ExtractRefreshTask,
  UpdateCloudExtractRefreshSchedule,
  updateCloudExtractRefreshScheduleSchema,
} from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import { readAppApprovalToken } from '../../../utils/appApprovalMeta.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { createAppApprovalEvidence } from '../_lib/appApproval.js';
import { auditRecordSchema } from '../_lib/auditRecord.js';
import { exportedForTesting as signedTokenTesting } from '../_lib/signedTokenEvidence.js';
import { mutationTokenConfigFromEnv } from '../_lib/signedTokenEvidence.mock.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  getUpdateCloudExtractRefreshTaskTool,
  scheduleBinding,
} from './updateCloudExtractRefreshTask.js';

// Auto-mock the logger so the durable audit record emitted by the mutation guard is captured as a
// spy call (AC-6) rather than written to stderr.
vi.mock('../../../logging/logger.js');

// All mutation-audit records emitted so far, each parsed through the authoritative schema so the
// assertion fails if the guard ever drops a required field.
function getAuditRecords(): ReturnType<typeof auditRecordSchema.parse>[] {
  const log = logger.log as MockedFunction<typeof logger.log>;
  return log.mock.calls
    .map((c) => c[0])
    .filter((e) => e.logger === 'audit')
    .map((e) => auditRecordSchema.parse(e.data));
}

// Convenience for the many single-audit-record assertions: asserts exactly one was emitted.
function getAuditRecord(): ReturnType<typeof auditRecordSchema.parse> {
  const records = getAuditRecords();
  expect(records).toHaveLength(1);
  return records[0];
}

// Extract the signed confirmation token the preview response echoes back.
function extractConfirmationToken(text: string): string {
  // Match the v1 token directly, skipping whatever quoting sits between the label and the value
  // (the preview text arrives JSON-escaped, so the quotes are `\"` not `"`).
  const match = text.match(
    /confirmationToken:[^v]*(v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43})/,
  );
  invariant(match, `expected a confirmationToken in preview text, got: ${text}`);
  return match[1];
}

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
    signedTokenTesting.reset();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({
      id: 'owner-1',
      name: 'Owner One',
      email: 'owner@example.com',
      siteRole: 'SiteAdministratorCreator',
    });
    mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(new Ok(updatedTask));
    // Default: the task list resolves this task to its underlying datasource so the audit target is
    // enriched (AC-3). Tests that don't care about enrichment are unaffected (best-effort, id always
    // present).
    mocks.mockListExtractRefreshTasks.mockResolvedValue([
      { id: validTaskId, datasource: { id: 'ds-1' } },
    ]);
    mocks.mockQueryDatasource.mockResolvedValue({
      id: 'ds-1',
      name: 'Sales Extract',
      project: { name: 'Finance' },
      owner: { id: 'owner-1' },
    });
    // Default: mcp-apps flag OFF → today's exact confirm-only behavior.
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = await getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.name).toBe('update-cloud-extract-refresh-task');
    expect(tool.description).toContain('Updates the schedule of an extract refresh task');
    expect(tool.paramsSchema).toHaveProperty('taskId');
    expect(tool.paramsSchema).toHaveProperty('schedule');
  });

  it('should have correct annotations', async () => {
    const tool = await getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.annotations).toEqual({
      title: 'Update Cloud Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
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
      const tool = await getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(disabled);
    },
  );

  it('should successfully update an extract refresh task', async () => {
    const result = await previewThenConfirm({ taskId: validTaskId, schedule: validSchedule });
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
    expect(record.confirmationEvidence.kind).toBe('signed-token');
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
    const result = await previewThenConfirm({ taskId: validTaskId, schedule: validSchedule });
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
    const result = await previewThenConfirm({ taskId: validTaskId, schedule: validSchedule });
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
    const result = await previewThenConfirm({ taskId: validTaskId, schedule: hourly });
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
      const result = await previewThenConfirm({ taskId: validTaskId, schedule: validSchedule });
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
      const result = await previewThenConfirm({ taskId: validTaskId, schedule: validSchedule });
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
      const result = await previewThenConfirm({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Weekly');
      // Falls back to args.schedule.frequencyDetails.start.
      expect(result.content[0].text).toContain('06:00:00');
    });
  });

  // --- AC-6: preview→confirm signed-token gate + audit records outcome, not just intent ---

  describe('AC-6 confirm gate and audit', () => {
    it('AC-6(a): preview (confirm omitted) does NOT apply the update and audits an allowed preview', async () => {
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Preview');
      expect(result.content[0].text).toContain('No change has been made');
      // The gate is the preview→confirm nonce: preview only mints a token, it never applies.
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
      const record = getAuditRecord();
      expect(record.result).toBe('allowed');
      expect(record.phase).toBe('preview');
      expect(record.action).toBe('update');
      // Now a signed-token gate (bound to the previewed schedule), not the old confirm-only 'none'.
      expect(record.confirmationEvidence.kind).toBe('signed-token');
    });

    it('AC-6(b): confirm with a valid preview token applies the update and audits a single completed', async () => {
      const result = await previewThenConfirm({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(false);
      expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalled();
      // A confirm logs exactly once: the preview emitted its own allowed record, and the confirm
      // emits only the terminal 'completed' outcome.
      const records = getAuditRecords();
      const confirmRecords = records.filter((r) => r.phase === 'confirm');
      expect(confirmRecords.map((r) => r.result)).toEqual(['completed']);
      expect(confirmRecords.every((r) => r.action === 'update')).toBe(true);
      expect(confirmRecords.every((r) => r.target.id === validTaskId)).toBe(true);
      // AC-3 / Gap-B: the audit target is enriched from the task's underlying datasource.
      expect(confirmRecords.every((r) => r.target.name === 'Sales Extract')).toBe(true);
      expect(confirmRecords.every((r) => r.target.project === 'Finance')).toBe(true);
      expect(confirmRecords.every((r) => r.target.owner === 'owner@example.com')).toBe(true);
    });

    // Fix #1: the confirm is bound to the exact schedule that was previewed. A token minted for
    // schedule A must NOT confirm an update to schedule B — otherwise a confirm could apply a payload
    // the human never previewed.
    it('AC-6(c): a token minted for one schedule cannot confirm a different schedule', async () => {
      const previewResult = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      invariant(previewResult.content[0].type === 'text');
      const token = extractConfirmationToken(previewResult.content[0].text);

      const swappedSchedule: UpdateCloudExtractRefreshSchedule = {
        frequency: 'Daily',
        frequencyDetails: {
          start: '09:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      };
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: swappedSchedule,
        confirm: true,
        confirmationToken: token,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('could not verify that a preview ran');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
      const denied = getAuditRecords().find((r) => r.result === 'denied');
      invariant(denied, 'expected a denied audit record');
      expect(denied.denyReason).toBe('preview-not-run');
    });

    // Fix #1: confirm with no prior preview (no token) is rejected server-side — the whole point of
    // the gate is that it cannot be bypassed by calling confirm first.
    it('AC-6(d): confirm without a confirmation token is rejected and applies nothing', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('could not verify that a preview ran');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    // Fix #1: a token that already confirmed once cannot be replayed on the same replica (per-process
    // replay cache in SignedTokenEvidence).
    it('AC-6(e): a confirmation token cannot be replayed after it succeeds once', async () => {
      const previewResult = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      invariant(previewResult.content[0].type === 'text');
      const token = extractConfirmationToken(previewResult.content[0].text);

      const first = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
        confirmationToken: token,
      });
      expect(first.isError).toBe(false);

      const replay = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
        confirmationToken: token,
      });
      expect(replay.isError).toBe(true);
      invariant(replay.content[0].type === 'text');
      expect(replay.content[0].text).toContain('could not verify that a preview ran');
    });

    // Fix #2: the audit trail must reflect OUTCOME, not just intent. When the confirmed REST call
    // fails, the sole confirm record is 'failed' (with detail) — never a bare 'allowed' that would
    // claim a mutation which never happened.
    it('AC-6(f): a failed confirmed update audits a single failed (not completed, not allowed)', async () => {
      mocks.mockUpdateCloudExtractRefreshTask.mockResolvedValue(
        new Err({
          type: 'tableau-api',
          status: 409,
          code: '409004',
          summary: 'Conflict',
          detail: 'Invalid subscription schedule',
        }),
      );
      const result = await previewThenConfirm({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(true);
      const confirmRecords = getAuditRecords().filter((r) => r.phase === 'confirm');
      expect(confirmRecords.map((r) => r.result)).toEqual(['failed']);
      const failed = confirmRecords.find((r) => r.result === 'failed');
      invariant(failed, 'expected a failed audit record');
      expect(failed.failureDetail).toContain('Tableau 409');
      expect(failed.failureDetail).toContain('409004');
    });

    // Fix #1: the schedule binding is a hash of a KEY-ORDER-INDEPENDENT canonicalization. A confirm
    // whose schedule is logically identical to the preview but with object keys in a different order
    // must still validate — otherwise the binding would reject harmless re-serialization and this
    // security helper's canonicalize step could silently regress to a plain JSON.stringify.
    it('AC-6(g): a confirm with reordered (logically identical) schedule keys still validates', async () => {
      // Preview with one key order.
      const previewSchedule: UpdateCloudExtractRefreshSchedule = {
        frequency: 'Hourly',
        frequencyDetails: {
          start: '08:00:00',
          end: '18:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      };
      const previewResult = await getToolResult({
        taskId: validTaskId,
        schedule: previewSchedule,
      });
      invariant(previewResult.content[0].type === 'text');
      const token = extractConfirmationToken(previewResult.content[0].text);

      // Confirm with the SAME values but every object's keys emitted in a different order.
      const reorderedSchedule = {
        frequencyDetails: {
          intervals: { interval: [{ weekDay: 'Monday' }] },
          end: '18:00:00',
          start: '08:00:00',
        },
        frequency: 'Hourly',
      } as unknown as UpdateCloudExtractRefreshSchedule;
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: reorderedSchedule,
        confirm: true,
        confirmationToken: token,
      });
      expect(result.isError).toBe(false);
      expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalled();
    });

    // Non-blocking review follow-up: `canonicalize` sorts array elements, not just object keys.
    // Tableau treats `intervals.interval` as an order-independent bag, so a caller that lists the
    // same intervals in a different order between preview and confirm must still validate — without
    // element sorting this would spuriously fail with `preview-not-run` (fail-closed but flaky HITL).
    it('AC-6(h): a confirm whose intervals are reordered (same bag) still validates', async () => {
      const previewSchedule: UpdateCloudExtractRefreshSchedule = {
        frequency: 'Hourly',
        frequencyDetails: {
          start: '08:00:00',
          end: '18:00:00',
          intervals: { interval: [{ hours: 2 }, { weekDay: 'Monday' }] },
        },
      };
      const previewResult = await getToolResult({ taskId: validTaskId, schedule: previewSchedule });
      invariant(previewResult.content[0].type === 'text');
      const token = extractConfirmationToken(previewResult.content[0].text);

      // Confirm with the interval array elements in the OPPOSITE order.
      const reorderedSchedule: UpdateCloudExtractRefreshSchedule = {
        frequency: 'Hourly',
        frequencyDetails: {
          start: '08:00:00',
          end: '18:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }, { hours: 2 }] },
        },
      };
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: reorderedSchedule,
        confirm: true,
        confirmationToken: token,
      });
      expect(result.isError).toBe(false);
      expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalled();
    });
  });

  describe('signed confirmation token (SignedTokenEvidence)', () => {
    const currentDaily = {
      frequency: 'Daily',
      nextRunAt: '2026-11-22T06:00:00Z',
      frequencyDetails: {
        start: '02:00:00',
        intervals: { interval: { weekDay: 'Monday' } },
      },
    };

    async function previewToken(): Promise<string> {
      const previewResult = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      invariant(previewResult.content[0].type === 'text');
      expect(previewResult.content[0].text).toContain('short-lived token bound to this change');
      expect(previewResult.content[0].text).not.toContain('single-use');
      return extractConfirmationToken(previewResult.content[0].text);
    }

    async function confirmWith(token: string): Promise<CallToolResult> {
      return await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
        confirmationToken: token,
      });
    }

    beforeEach(() => {
      mocks.mockListExtractRefreshTasks.mockResolvedValue([
        { id: validTaskId, datasource: { id: 'ds-1' }, schedule: currentDaily },
      ]);
    });

    it('preview returns a v1 token', async () => {
      expect(await previewToken()).toMatch(/^v1\./);
    });

    it('rejects the confirm when the task schedule changed after the preview', async () => {
      const token = await previewToken();
      mocks.mockListExtractRefreshTasks.mockResolvedValue([
        {
          id: validTaskId,
          datasource: { id: 'ds-1' },
          schedule: {
            ...currentDaily,
            frequencyDetails: { ...currentDaily.frequencyDetails, start: '03:00:00' },
          },
        },
      ]);
      const result = await confirmWith(token);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('could not verify that a preview ran');
      expect(result.content[0].text).toContain('The target changed after the preview');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('still accepts the confirm when only nextRunAt moved (not part of the state)', async () => {
      const token = await previewToken();
      mocks.mockListExtractRefreshTasks.mockResolvedValue([
        {
          id: validTaskId,
          datasource: { id: 'ds-1' },
          schedule: { ...currentDaily, nextRunAt: '2026-11-23T06:00:00Z' },
        },
      ]);
      expect((await confirmWith(token)).isError).toBe(false);
      expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledOnce();
    });

    it('confirms on a fresh process with the same MUTATION_TOKEN_SECRET (cross-replica)', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', 'extract-task-replica-secret-0123456789ab');
      signedTokenTesting.reset();
      const token = await previewToken();
      signedTokenTesting.reset(); // a different replica: fresh keys + replay cache, same secret
      expect((await confirmWith(token)).isError).toBe(false);
      expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledOnce();
    });

    it('rejects a token from a fresh process with no shared secret (per-process key)', async () => {
      const token = await previewToken();
      signedTokenTesting.reset(); // a different replica with its own random key
      expect((await confirmWith(token)).isError).toBe(true);
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    // MAJOR-1: the pre-state read (Get Extract Refresh Tasks, tableau:tasks:read) must not silently
    // fall back to '' on one phase while the other resolved the real schedule.
    it('rejects the confirm when the preview resolved the schedule but the confirm could not', async () => {
      const token = await previewToken();
      mocks.mockListExtractRefreshTasks.mockRejectedValue(
        new Error('401 missing tableau:tasks:read'),
      );
      const result = await confirmWith(token);
      expect(result.isError).toBe(true);
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('rejects the confirm when the preview could not resolve the schedule but the confirm could', async () => {
      // A preview that cannot read the schedule fails closed and mints no token, so there is
      // nothing for a later confirm to verify.
      mocks.mockListExtractRefreshTasks.mockRejectedValueOnce(
        new Error('401 missing tableau:tasks:read'),
      );
      const previewResult = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(previewResult.isError).toBe(true);
      invariant(previewResult.content[0].type === 'text');
      expect(previewResult.content[0].text).not.toMatch(/v1\.[0-9]+\./);

      // Even a token bound to the empty state ('' — what the old silent fallback produced) does
      // not confirm once the confirm resolves the real schedule.
      const emptyStateEvidence = new (
        await import('../_lib/signedTokenEvidence.js')
      ).SignedTokenEvidence();
      await emptyStateEvidence.establish({
        restApi: { siteId: 'test-site-id' } as never,
        siteId: 'test-site-id',
        target: { id: validTaskId, kind: 'extract-refresh-task', state: '' },
        tool: 'update-cloud-extract-refresh-task',
        userLuid: getMockRequestHandlerExtra().getUserLuid(),
        binding: scheduleBinding(validSchedule),
      });
      const staleToken = emptyStateEvidence.getEstablishedNonce();
      invariant(staleToken);
      const result = await confirmWith(staleToken);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('The target changed after the preview');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    // W-25002517: a token consented before this tool required tableau:tasks:read is refused on the
    // pre-state read. The error names the scope and says to reconnect (not the generic "Permission
    // denied (403)" from tool.ts), audits DENIED, mints no token and applies nothing.
    it.each([401, 403])(
      'preview names tableau:tasks:read and says to reconnect when the schedule read is refused (%i)',
      async (status) => {
        mocks.mockListExtractRefreshTasks.mockRejectedValue(makeHttpError(status));
        const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        const text = result.content[0].text;
        expect(text).toContain(
          "Could not read this extract refresh task's current schedule to prepare the confirmation (requires tableau:tasks:read)",
        );
        expect(text).toContain('Reconnect Tableau');
        expect(text).not.toContain('Permission denied');
        expect(text).not.toMatch(/v1\.[0-9]+\./);
        expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
        const records = getAuditRecords();
        expect(records).toHaveLength(1);
        expect(records[0].result).toBe('denied');
        expect(records[0].denyReason).toBe('confirmation-pre-state-forbidden');
      },
    );

    it('confirm names tableau:tasks:read when the schedule re-read is refused, and applies nothing', async () => {
      const token = await previewToken();
      mocks.mockListExtractRefreshTasks.mockRejectedValue(makeHttpError(403));
      const result = await confirmWith(token);
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('requires tableau:tasks:read');
      expect(result.content[0].text).toContain('Reconnect Tableau');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('never writes the token into the audit record', async () => {
      const token = await previewToken();
      await confirmWith(token);
      const serialized = JSON.stringify(getAuditRecords());
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain(token.split('.')[2]);
    });
  });

  // --- MCP-Apps flag ON: preview carries the iframe app + records a human-approval window ---

  describe('with mcp-apps flag ON', () => {
    beforeEach(() => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    });

    it('carries the update-cloud-extract-refresh-task app config so the host renders the confirm iframe', async () => {
      const tool = await getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
      expect(tool.app).toBeDefined();
      expect(tool.app?.resourceUri).toContain('update-cloud-extract-refresh-task');
    });

    it('preview returns an AppToolResult panel AND a signed approval token in _meta only', async () => {
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.data.kind).toBe('update-cloud-extract-refresh-task-confirm');
      expect(payload.data.taskId).toBe(validTaskId);
      expect(payload.data.schedule.frequency).toBe('Weekly');
      expect(typeof payload.data.expiresAtMs).toBe('number');
      // The destructive update never runs during preview.
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();

      // SECURITY: the approval token reaches the iframe in `_meta` only — never the model-visible text.
      const approvalToken = readAppApprovalToken(result);
      expect(approvalToken).toMatch(/^v1\./);
      expect(result.content[0].text).not.toContain(approvalToken!);
      expect(result.content[0].text).not.toMatch(/nonce|token|secret/i);

      // The token verifies under the 'update-cloud-extract-refresh-task' namespace, bound to the
      // previewed schedule (a token minted for schedule A does not satisfy a confirm for B).
      const extra = getMockRequestHandlerExtra();
      const confirmCtx = {
        restApi: { siteId: 'test-site-id' } as never,
        siteId: 'test-site-id',
        target: { id: validTaskId, kind: 'extract-refresh-task' as const },
        tool: 'confirm-update-cloud-extract-refresh-task' as const,
        userLuid: extra.getUserLuid(),
        confirmationToken: approvalToken,
      };
      await expect(
        createAppApprovalEvidence('update-cloud-extract-refresh-task').verify({
          ...confirmCtx,
          binding: scheduleBinding({ ...validSchedule, frequency: 'Daily' } as never),
        }),
      ).resolves.toBe(false);
      await expect(
        createAppApprovalEvidence('update-cloud-extract-refresh-task').verify({
          ...confirmCtx,
          binding: scheduleBinding(validSchedule),
        }),
      ).resolves.toBe(true);
    });

    it('binds the approval token to the task schedule at preview time (state-bound)', async () => {
      const currentSchedule = {
        frequency: 'Daily',
        frequencyDetails: { start: '02:00:00', intervals: { interval: { weekDay: 'Monday' } } },
      };
      mocks.mockListExtractRefreshTasks.mockResolvedValue([
        { id: validTaskId, datasource: { id: 'ds-1' }, schedule: currentSchedule },
      ]);
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      const approvalToken = readAppApprovalToken(result);
      const { extractRefreshScheduleState } =
        await import('../_lib/resolveExtractRefreshTaskTarget.js');
      const confirmCtx = {
        restApi: { siteId: 'test-site-id' } as never,
        siteId: 'test-site-id',
        tool: 'confirm-update-cloud-extract-refresh-task' as const,
        userLuid: getMockRequestHandlerExtra().getUserLuid(),
        confirmationToken: approvalToken,
        binding: scheduleBinding(validSchedule),
      };
      // Wrong / missing state rejects; the preview-time state verifies.
      await expect(
        createAppApprovalEvidence('update-cloud-extract-refresh-task').verify({
          ...confirmCtx,
          target: { id: validTaskId, kind: 'extract-refresh-task', state: '' },
        }),
      ).resolves.toBe(false);
      await expect(
        createAppApprovalEvidence('update-cloud-extract-refresh-task').verify({
          ...confirmCtx,
          target: {
            id: validTaskId,
            kind: 'extract-refresh-task',
            state: extractRefreshScheduleState(currentSchedule),
          },
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
  confirmationToken?: string;
}): Promise<CallToolResult> {
  const tool = await getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      taskId: args.taskId,
      schedule: args.schedule,
      confirm: args.confirm,
      confirmationToken: args.confirmationToken,
    },
    getMockRequestHandlerExtra(),
  );
}

// Two-phase convenience: run the preview to mint the schedule-bound signed token, then confirm
// with it. Mirrors the real caller contract (a confirm now REQUIRES a token from a prior preview of
// this same taskId + schedule). Returns the confirm-phase result. Use for the many tests that assert
// the applied update or its error handling.
async function previewThenConfirm(args: {
  taskId: string;
  schedule: UpdateCloudExtractRefreshSchedule;
}): Promise<CallToolResult> {
  const previewResult = await getToolResult({ taskId: args.taskId, schedule: args.schedule });
  invariant(previewResult.content[0].type === 'text');
  const confirmationToken = extractConfirmationToken(previewResult.content[0].text);
  return await getToolResult({
    taskId: args.taskId,
    schedule: args.schedule,
    confirm: true,
    confirmationToken,
  });
}

function makeHttpError(status: number): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}
