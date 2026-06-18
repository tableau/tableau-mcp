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
import { getUpdateCloudExtractRefreshTaskTool } from './updateCloudExtractRefreshTask.js';

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
        status: 400,
        code: '409004',
        summary: 'Bad Request',
        detail: 'Invalid subscription schedule',
      }),
    );
    const result = await getToolResult({ taskId: validTaskId, schedule: validSchedule });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Tableau 400');
    expect(result.content[0].text).toContain('[409004]');
    expect(result.content[0].text).toContain('Bad Request');
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
        intervals: { interval: [{ hours: 2 }] },
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
        frequencyDetails: { start: '06:00:00' },
      });
      expect(result.success).toBe(true);
    });

    it('should reject Hourly schedule missing end', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Hourly',
        frequencyDetails: { start: '06:00:00' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('end is required for Hourly');
      }
    });

    it('should reject Hourly schedule with mismatched minute portions', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Hourly',
        frequencyDetails: { start: '06:00:00', end: '18:30:00' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('same minute');
      }
    });

    it('should reject Hourly schedule with end before start', () => {
      const result = updateCloudExtractRefreshScheduleSchema.safeParse({
        frequency: 'Hourly',
        frequencyDetails: { start: '18:00:00', end: '06:00:00' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('strictly after');
      }
    });
  });
});

async function getToolResult(args: {
  taskId: string;
  schedule: UpdateCloudExtractRefreshSchedule;
}): Promise<CallToolResult> {
  const tool = getUpdateCloudExtractRefreshTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
