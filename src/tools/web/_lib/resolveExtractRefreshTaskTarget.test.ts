import { ConfirmationPreStateForbiddenError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import {
  extractRefreshScheduleState,
  resolveExtractRefreshTaskTarget,
} from './resolveExtractRefreshTaskTarget.js';

// Auto-mock the logger so the best-effort warning on a resolve failure is captured, not written to
// stderr.
vi.mock('../../../logging/logger.js');

const siteId = 'test-site-id';
const taskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';

const mocks = vi.hoisted(() => ({
  mockListExtractRefreshTasks: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockGetWorkbook: vi.fn(),
  mockQueryUserOnSite: vi.fn(),
}));

function makeRestApi(): RestApi {
  return {
    siteId,
    tasksMethods: { listExtractRefreshTasks: mocks.mockListExtractRefreshTasks },
    datasourcesMethods: { queryDatasource: mocks.mockQueryDatasource },
    workbooksMethods: { getWorkbook: mocks.mockGetWorkbook },
    usersMethods: { queryUserOnSite: mocks.mockQueryUserOnSite },
  } as unknown as RestApi;
}

describe('resolveExtractRefreshTaskTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockQueryUserOnSite.mockResolvedValue({
      id: 'owner-1',
      name: 'Owner One',
      email: 'owner@example.com',
    });
  });

  it('derives name/project/owner from the underlying DATASOURCE', async () => {
    const tasks: ExtractRefreshTask[] = [{ id: taskId, datasource: { id: 'ds-1' } }];
    mocks.mockQueryDatasource.mockResolvedValue({
      id: 'ds-1',
      name: 'Sales Extract',
      project: { name: 'Finance' },
      owner: { id: 'owner-1' },
    });
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks,
    });
    expect(target).toEqual({
      id: taskId,
      name: 'Sales Extract',
      project: 'Finance',
      owner: 'owner@example.com',
      kind: 'extract-refresh-task',
    });
    // The already-fetched task list was reused — no re-list.
    expect(mocks.mockListExtractRefreshTasks).not.toHaveBeenCalled();
  });

  it('derives name/project/owner from the underlying WORKBOOK when there is no datasource', async () => {
    const tasks: ExtractRefreshTask[] = [{ id: taskId, workbook: { id: 'wb-1' } }];
    mocks.mockGetWorkbook.mockResolvedValue({
      id: 'wb-1',
      name: 'Exec Dashboard',
      project: { name: 'Leadership' },
      owner: { id: 'owner-1' },
    });
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks,
    });
    expect(target).toEqual({
      id: taskId,
      name: 'Exec Dashboard',
      project: 'Leadership',
      owner: 'owner@example.com',
      kind: 'extract-refresh-task',
    });
  });

  it('lists tasks itself when none are pre-fetched', async () => {
    mocks.mockListExtractRefreshTasks.mockResolvedValue([
      { id: taskId, datasource: { id: 'ds-1' } },
    ]);
    mocks.mockQueryDatasource.mockResolvedValue({
      id: 'ds-1',
      name: 'Sales Extract',
      project: { name: 'Finance' },
      owner: { id: 'owner-1' },
    });
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
    });
    expect(mocks.mockListExtractRefreshTasks).toHaveBeenCalledOnce();
    expect(target.name).toBe('Sales Extract');
  });

  it('degrades to id-only when the task has no datasource/workbook reference', async () => {
    const tasks: ExtractRefreshTask[] = [{ id: taskId }];
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks,
    });
    expect(target).toEqual({ id: taskId, kind: 'extract-refresh-task' });
    expect(mocks.mockQueryDatasource).not.toHaveBeenCalled();
  });

  it('degrades to id-only when the task id is not in the list', async () => {
    const tasks: ExtractRefreshTask[] = [{ id: 'some-other-id', datasource: { id: 'ds-9' } }];
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks,
    });
    expect(target).toEqual({ id: taskId, kind: 'extract-refresh-task' });
  });

  it('degrades to id-only (never throws) when the content lookup fails', async () => {
    const tasks: ExtractRefreshTask[] = [{ id: taskId, datasource: { id: 'ds-1' } }];
    mocks.mockQueryDatasource.mockRejectedValue(new Error('403 querying datasource'));
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks,
    });
    expect(target).toEqual({ id: taskId, kind: 'extract-refresh-task' });
  });

  it('leaves owner undefined when the owner lookup returns nothing (best-effort)', async () => {
    const tasks: ExtractRefreshTask[] = [{ id: taskId, datasource: { id: 'ds-1' } }];
    mocks.mockQueryDatasource.mockResolvedValue({
      id: 'ds-1',
      name: 'Sales Extract',
      project: { name: 'Finance' },
      owner: { id: 'owner-1' },
    });
    // resolveOwnerEmail returns null when the user query fails; it never throws.
    mocks.mockQueryUserOnSite.mockRejectedValue(new Error('user not found'));
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks,
    });
    expect(target.name).toBe('Sales Extract');
    expect(target.project).toBe('Finance');
    expect(target.owner).toBeUndefined();
  });
});

describe('extractRefreshScheduleState', () => {
  const daily = {
    frequency: 'Daily',
    nextRunAt: '2026-11-22T06:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    frequencyDetails: {
      start: '02:00:00',
      intervals: { interval: [{ weekDay: 'Monday' }, { weekDay: 'Friday' }] },
    },
  };

  it('is a deterministic hex hash', () => {
    expect(extractRefreshScheduleState(daily)).toMatch(/^[0-9a-f]{64}$/);
    expect(extractRefreshScheduleState(daily)).toBe(extractRefreshScheduleState({ ...daily }));
  });

  it('is empty for a task with no schedule', () => {
    expect(extractRefreshScheduleState(undefined)).toBe('');
  });

  it('ignores nextRunAt / updatedAt / server bookkeeping fields', () => {
    expect(
      extractRefreshScheduleState({
        ...daily,
        nextRunAt: '2026-12-01T06:00:00Z',
        updatedAt: '2026-11-20T00:00:00Z',
        state: 'Active',
        id: 'sched-1',
      }),
    ).toBe(extractRefreshScheduleState(daily));
  });

  it('is independent of key order and interval order', () => {
    const reordered = {
      frequencyDetails: {
        intervals: { interval: [{ weekDay: 'Friday' }, { weekDay: 'Monday' }] },
        start: '02:00:00',
      },
      frequency: 'Daily',
    };
    expect(extractRefreshScheduleState(reordered)).toBe(extractRefreshScheduleState(daily));
  });

  it('treats a single interval object the same as a one-element array', () => {
    const asObject = {
      frequency: 'Weekly',
      frequencyDetails: { start: '06:00:00', intervals: { interval: { weekDay: 'Sunday' } } },
    };
    const asArray = {
      frequency: 'Weekly',
      frequencyDetails: { start: '06:00:00', intervals: { interval: [{ weekDay: 'Sunday' }] } },
    };
    expect(extractRefreshScheduleState(asObject)).toBe(extractRefreshScheduleState(asArray));
  });

  it.each([
    ['frequency', { ...daily, frequency: 'Weekly' }],
    ['start', { ...daily, frequencyDetails: { ...daily.frequencyDetails, start: '03:00:00' } }],
    ['end', { ...daily, frequencyDetails: { ...daily.frequencyDetails, end: '23:00:00' } }],
    [
      'intervals',
      {
        ...daily,
        frequencyDetails: {
          ...daily.frequencyDetails,
          intervals: { interval: [{ weekDay: 'Monday' }] },
        },
      },
    ],
  ])('changes when %s changes', (_label, changed) => {
    expect(extractRefreshScheduleState(changed)).not.toBe(extractRefreshScheduleState(daily));
  });
});

describe('resolveExtractRefreshTaskTarget includeScheduleState', () => {
  const schedule = {
    frequency: 'Daily',
    frequencyDetails: { start: '02:00:00', intervals: { interval: { weekDay: 'Monday' } } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockQueryUserOnSite.mockResolvedValue({ id: 'owner-1', email: 'owner@example.com' });
  });

  it('omits state by default (delete-content keeps a stateless token)', async () => {
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks: [{ id: taskId, schedule }],
    });
    expect(target).not.toHaveProperty('state');
  });

  it('returns the schedule state with the enriched target', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({
      id: 'ds-1',
      name: 'DS',
      owner: { id: 'owner-1' },
    });
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks: [{ id: taskId, datasource: { id: 'ds-1' }, schedule }],
      includeScheduleState: true,
    });
    expect(target.name).toBe('DS');
    expect(target.state).toBe(extractRefreshScheduleState(schedule));
  });

  it('keeps the schedule state when content enrichment fails', async () => {
    mocks.mockQueryDatasource.mockRejectedValue(new Error('boom'));
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks: [{ id: taskId, datasource: { id: 'ds-1' }, schedule }],
      includeScheduleState: true,
    });
    expect(target).toEqual({
      id: taskId,
      kind: 'extract-refresh-task',
      state: extractRefreshScheduleState(schedule),
    });
  });

  it('returns state for a task with no content reference', async () => {
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks: [{ id: taskId, schedule }],
      includeScheduleState: true,
    });
    expect(target.state).toBe(extractRefreshScheduleState(schedule));
  });

  it('degrades to id-only when the task LIST fails and no state is requested', async () => {
    mocks.mockListExtractRefreshTasks.mockRejectedValue(
      new Error('401 missing tableau:tasks:read'),
    );
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
    });
    expect(target).toEqual({ id: taskId, kind: 'extract-refresh-task' });
  });

  it('fails closed (throws) when the task LIST fails and the schedule state is requested', async () => {
    // Without the list the pre-state is unknowable; an empty fallback would let one phase bind ''
    // while the other bound the real schedule (or let both silently agree on '').
    mocks.mockListExtractRefreshTasks.mockRejectedValue(
      new Error('401 missing tableau:tasks:read'),
    );
    await expect(
      resolveExtractRefreshTaskTarget({
        restApi: makeRestApi(),
        siteId,
        taskId,
        includeScheduleState: true,
      }),
    ).rejects.toThrow('401 missing tableau:tasks:read');
  });

  it.each([401, 403])(
    'rethrows a %i on the task LIST as a scope-naming error when the schedule state is requested',
    async (status) => {
      mocks.mockListExtractRefreshTasks.mockRejectedValue(
        Object.assign(new Error(`Request failed with status code ${status}`), {
          isAxiosError: true,
          response: { status },
        }),
      );
      const promise = resolveExtractRefreshTaskTarget({
        restApi: makeRestApi(),
        siteId,
        taskId,
        includeScheduleState: true,
      });
      await expect(promise).rejects.toBeInstanceOf(ConfirmationPreStateForbiddenError);
      await expect(promise).rejects.toMatchObject({
        statusCode: status,
        requiredScopes: ['tableau:tasks:read'],
        message: expect.stringContaining(
          "Could not read this extract refresh task's current schedule to prepare the confirmation (requires tableau:tasks:read)",
        ),
      });
    },
  );

  it('still degrades to id-only on a 403 task LIST when no state is requested', async () => {
    mocks.mockListExtractRefreshTasks.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: { status: 403 },
      }),
    );
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
    });
    expect(target).toEqual({ id: taskId, kind: 'extract-refresh-task' });
  });

  it('returns empty state when the task is not in the list', async () => {
    const target = await resolveExtractRefreshTaskTarget({
      restApi: makeRestApi(),
      siteId,
      taskId,
      tasks: [],
      includeScheduleState: true,
    });
    expect(target.state).toBe('');
  });
});
