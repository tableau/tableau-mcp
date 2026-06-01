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
});
