import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExtractRefreshTask } from '../../../sdks/tableau/types/extractRefreshTask.js';
import { resolveExtractRefreshTaskTarget } from './resolveExtractRefreshTaskTarget.js';

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
