import { describe, expect, it, vi } from 'vitest';

import TasksMethods from './tasksMethods.js';

describe('TasksMethods', () => {
  describe('listExtractRefreshTasks', () => {
    it('should handle array response format', async () => {
      const mockApiClient = {
        listExtractRefreshTasks: vi.fn().mockResolvedValue({
          tasks: [
            { extractRefresh: { id: 't1', datasource: { id: 'd1' } } },
            { extractRefresh: { id: 't2', workbook: { id: 'w1' } } },
          ],
        }),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      const result = await tasksMethods.listExtractRefreshTasks({ siteId: 'site-1' });

      expect(result).toEqual([
        { id: 't1', datasource: { id: 'd1' } },
        { id: 't2', workbook: { id: 'w1' } },
      ]);
    });

    it('should handle object with task array format', async () => {
      const mockApiClient = {
        listExtractRefreshTasks: vi.fn().mockResolvedValue({
          tasks: {
            task: [
              { extractRefresh: { id: 't1', datasource: { id: 'd1' } } },
              { extractRefresh: { id: 't2', workbook: { id: 'w1' } } },
            ],
          },
        }),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      const result = await tasksMethods.listExtractRefreshTasks({ siteId: 'site-1' });

      expect(result).toEqual([
        { id: 't1', datasource: { id: 'd1' } },
        { id: 't2', workbook: { id: 'w1' } },
      ]);
    });

    it('should handle single task object format', async () => {
      const mockApiClient = {
        listExtractRefreshTasks: vi.fn().mockResolvedValue({
          tasks: {
            task: { extractRefresh: { id: 't1', datasource: { id: 'd1' } } },
          },
        }),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      const result = await tasksMethods.listExtractRefreshTasks({ siteId: 'site-1' });

      expect(result).toEqual([{ id: 't1', datasource: { id: 'd1' } }]);
    });

    it('should handle empty task object format', async () => {
      const mockApiClient = {
        listExtractRefreshTasks: vi.fn().mockResolvedValue({
          tasks: {},
        }),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      const result = await tasksMethods.listExtractRefreshTasks({ siteId: 'site-1' });

      expect(result).toEqual([]);
    });

    it('should handle task with schedule information', async () => {
      const mockApiClient = {
        listExtractRefreshTasks: vi.fn().mockResolvedValue({
          tasks: {
            task: [
              {
                extractRefresh: {
                  id: 't1',
                  datasource: { id: 'd1' },
                  schedule: {
                    id: 's1',
                    name: 'Daily',
                    frequency: 'Daily',
                    nextRunAt: '2026-05-21T08:00:00Z',
                    frequencyDetails: {
                      intervals: {
                        interval: [{ hours: '8', minutes: '0' }],
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      const result = await tasksMethods.listExtractRefreshTasks({ siteId: 'site-1' });

      const interval = result[0].schedule?.frequencyDetails?.intervals?.interval;
      expect(Array.isArray(interval)).toBe(true);
      if (Array.isArray(interval)) {
        expect(interval[0].hours).toBe(8);
        expect(interval[0].minutes).toBe(0);
      }
    });
  });

  describe('updateCloudExtractRefreshTask', () => {
    // The Tableau Cloud "Update Extract Refresh Task" endpoint returns `extractRefresh` and
    // `schedule` as siblings at the response root rather than nesting `schedule` inside the task.
    // This test guards the merge logic that hands callers a single ExtractRefreshTask shape
    // matching what list-extract-refresh-tasks returns.
    it('should merge sibling extractRefresh + schedule into an Ok ExtractRefreshTask', async () => {
      const mockApiClient = {
        updateCloudExtractRefreshTask: vi.fn().mockResolvedValue({
          extractRefresh: {
            id: 't1',
            type: 'RefreshExtractTask',
            datasource: { id: 'd1' },
          },
          schedule: {
            frequency: 'Weekly',
            frequencyDetails: {
              start: '06:00:00',
              intervals: { interval: [{ weekDay: 'Sunday' }] },
            },
          },
        }),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      const result = await tasksMethods.updateCloudExtractRefreshTask({
        siteId: 'site-1',
        taskId: 't1',
        schedule: {
          frequency: 'Weekly',
          frequencyDetails: {
            start: '06:00:00',
            intervals: { interval: [{ weekDay: 'Sunday' }] },
          },
        },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const merged = result.value;
        expect(merged.id).toBe('t1');
        expect(merged.type).toBe('RefreshExtractTask');
        expect(merged.datasource).toEqual({ id: 'd1' });
        expect(merged.schedule?.frequency).toBe('Weekly');
        expect(merged.schedule?.frequencyDetails?.start).toBe('06:00:00');
      }
    });

    it('should pass through siteId, taskId, and request body to the api client', async () => {
      const mockApiClient = {
        updateCloudExtractRefreshTask: vi.fn().mockResolvedValue({
          extractRefresh: { id: 't1' },
          schedule: { frequency: 'Daily', frequencyDetails: { start: '06:00:00' } },
        }),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      await tasksMethods.updateCloudExtractRefreshTask({
        siteId: 'site-1',
        taskId: 'task-42',
        schedule: { frequency: 'Daily', frequencyDetails: { start: '06:00:00' } },
      });

      expect(mockApiClient.updateCloudExtractRefreshTask).toHaveBeenCalledWith(
        { schedule: { frequency: 'Daily', frequencyDetails: { start: '06:00:00' } } },
        expect.objectContaining({ params: { siteId: 'site-1', taskId: 'task-42' } }),
      );
    });

    it('should map an axios error with response body into a structured tableau-api Err', async () => {
      const axiosError = Object.assign(new Error('Request failed with status code 400'), {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            error: {
              code: '409004',
              summary: 'Bad Request',
              detail: 'Invalid subscription schedule',
            },
          },
        },
      });
      const mockApiClient = {
        updateCloudExtractRefreshTask: vi.fn().mockRejectedValue(axiosError),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      const result = await tasksMethods.updateCloudExtractRefreshTask({
        siteId: 'site-1',
        taskId: 't1',
        schedule: { frequency: 'Daily', frequencyDetails: { start: '06:00:00' } },
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toEqual({
          type: 'tableau-api',
          status: 400,
          code: '409004',
          summary: 'Bad Request',
          detail: 'Invalid subscription schedule',
        });
      }
    });

    it('should fall back to an unknown Err when the failure is not an axios error', async () => {
      const mockApiClient = {
        updateCloudExtractRefreshTask: vi.fn().mockRejectedValue(new Error('Boom')),
      };

      const tasksMethods = new TasksMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      tasksMethods._apiClient = mockApiClient;

      const result = await tasksMethods.updateCloudExtractRefreshTask({
        siteId: 'site-1',
        taskId: 't1',
        schedule: { frequency: 'Daily', frequencyDetails: { start: '06:00:00' } },
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toEqual({ type: 'unknown', message: 'Boom' });
      }
    });
  });
});
