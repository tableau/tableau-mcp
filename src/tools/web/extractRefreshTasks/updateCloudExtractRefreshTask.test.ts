import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import {
  ExtractRefreshTask,
  UpdateCloudExtractRefreshSchedule,
  updateCloudExtractRefreshScheduleSchema,
} from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  computeConfirmationToken,
  getUpdateCloudExtractRefreshTaskTool,
} from './updateCloudExtractRefreshTask.js';

const mocks = vi.hoisted(() => ({
  mockUpdateCloudExtractRefreshTask: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
  mockAssertAdmin: vi.fn(),
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

const validToken = computeConfirmationToken('test-site-id', validTaskId, validSchedule);

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
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.name).toBe('update-cloud-extract-refresh-task');
    expect(tool.description).toContain('Updates the schedule of an extract refresh task');
    expect(tool.paramsSchema).toHaveProperty('taskId');
    expect(tool.paramsSchema).toHaveProperty('schedule');
    expect(tool.paramsSchema).toHaveProperty('confirm');
    expect(tool.paramsSchema).toHaveProperty('confirmationToken');
  });

  it('should have correct annotations', () => {
    const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
    expect(tool.annotations).toEqual({
      title: 'Update Cloud Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
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
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
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
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires site administrator permissions');
    expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
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
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
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
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
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
    const result = await getToolResult({ taskId: validTaskId, schedule: hourly });
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
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
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
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
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
      const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Weekly');
      // Falls back to args.schedule.frequencyDetails.start.
      expect(result.content[0].text).toContain('06:00:00');
    });
  });

  describe('two-phase contract', () => {
    it('returns a preview without calling Tableau when confirm is omitted', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: false,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Preview');
      expect(result.content[0].text).toContain(validTaskId);
      expect(result.content[0].text).toContain('Weekly');
      // Token is the deterministic sha256(siteId:taskId:stableStringify(schedule))[0..12].
      expect(result.content[0].text).toContain(validToken);
      expect(result.content[0].text).toContain('confirm: true and confirmationToken');
      // No Tableau call in the preview phase — admin gate runs but the update endpoint does not.
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('still runs the admin gate in the preview phase', async () => {
      mocks.mockAssertAdmin.mockResolvedValue(
        new Err('This tool requires site administrator permissions. Your site role is: Viewer'),
      );
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: false,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('requires site administrator permissions');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('rejects apply with a missing confirmationToken and never calls Tableau', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
        confirmationToken: undefined,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('confirmationToken returned by the preview step');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('rejects apply with a mismatched confirmationToken and never calls Tableau', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
        confirmationToken: 'deadbeefcafe',
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('confirmationToken returned by the preview step');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('applies the update when confirm is true and the confirmationToken matches', async () => {
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: true,
        confirmationToken: validToken,
      });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('successfully updated');
      expect(mocks.mockUpdateCloudExtractRefreshTask).toHaveBeenCalledTimes(1);
    });

    it('emits the same deterministic token across preview calls (idempotent friction gate)', async () => {
      const first = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: false,
      });
      const second = await getToolResult({
        taskId: validTaskId,
        schedule: validSchedule,
        confirm: false,
      });
      invariant(first.content[0].type === 'text');
      invariant(second.content[0].type === 'text');
      expect(first.content[0].text).toContain(validToken);
      expect(second.content[0].text).toContain(validToken);
    });

    it('binds the schedule payload into the token so preview A and apply B do not match', async () => {
      // Preview schedule A — returns token bound to A.
      const scheduleA: UpdateCloudExtractRefreshSchedule = validSchedule;
      const scheduleB: UpdateCloudExtractRefreshSchedule = {
        frequency: 'Daily',
        frequencyDetails: {
          start: '06:00:00',
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      };
      const tokenA = computeConfirmationToken('test-site-id', validTaskId, scheduleA);
      const tokenB = computeConfirmationToken('test-site-id', validTaskId, scheduleB);
      expect(tokenA).not.toBe(tokenB);

      // Applying schedule B with A's token must be rejected — closes the swap-after-preview vector
      // where a caller previews a benign schedule to obtain a token and then swaps to a more
      // aggressive one on the confirmed call.
      const result = await getToolResult({
        taskId: validTaskId,
        schedule: scheduleB,
        confirm: true,
        confirmationToken: tokenA,
      });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('taskId + schedule pair');
      expect(mocks.mockUpdateCloudExtractRefreshTask).not.toHaveBeenCalled();
    });

    it('hashes semantically equal schedules the same regardless of object key order', async () => {
      // Object.keys iteration would otherwise depend on insertion order; the stable-stringify
      // sorts keys so a caller who constructs the schedule with reordered top-level or nested
      // keys still gets a preview→apply match.
      const permuted: UpdateCloudExtractRefreshSchedule = {
        // Reversed top-level order
        frequencyDetails: {
          intervals: { interval: [{ weekDay: 'Sunday' }] },
          start: '06:00:00',
        },
        frequency: 'Weekly',
      };
      const canonicalToken = computeConfirmationToken('test-site-id', validTaskId, validSchedule);
      const permutedToken = computeConfirmationToken('test-site-id', validTaskId, permuted);
      expect(permutedToken).toBe(canonicalToken);
    });
  });
});

async function getToolResult(args: {
  taskId: string;
  schedule: UpdateCloudExtractRefreshSchedule;
  confirm?: boolean;
  confirmationToken?: string;
}): Promise<CallToolResult> {
  const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
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
        : computeConfirmationToken('test-site-id', args.taskId, args.schedule),
  };
  return await callback(resolved, getMockRequestHandlerExtra());
}
