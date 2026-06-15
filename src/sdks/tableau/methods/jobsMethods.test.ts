import { describe, expect, it, vi } from 'vitest';

import JobsMethods from './jobsMethods.js';

const pagination = { pageNumber: 1, pageSize: 100, totalAvailable: 2 };

describe('JobsMethods', () => {
  describe('listJobs', () => {
    it('should handle backgroundJob array format', async () => {
      const mockApiClient = {
        listJobs: vi.fn().mockResolvedValue({
          pagination,
          backgroundJobs: {
            backgroundJob: [
              { id: 'j1', status: 'Success', jobType: 'refresh_extracts' },
              { id: 'j2', status: 'Failed', jobType: 'refresh_extracts' },
            ],
          },
        }),
      };

      const jobsMethods = new JobsMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      jobsMethods._apiClient = mockApiClient;

      const result = await jobsMethods.listJobs({ siteId: 'site-1' });

      expect(result.pagination).toEqual(pagination);
      expect(result.jobs).toEqual([
        { id: 'j1', status: 'Success', jobType: 'refresh_extracts' },
        { id: 'j2', status: 'Failed', jobType: 'refresh_extracts' },
      ]);
    });

    it('should handle a single backgroundJob object format', async () => {
      const mockApiClient = {
        listJobs: vi.fn().mockResolvedValue({
          pagination: { ...pagination, totalAvailable: 1 },
          backgroundJobs: {
            backgroundJob: { id: 'j1', status: 'Success', jobType: 'refresh_extracts' },
          },
        }),
      };

      const jobsMethods = new JobsMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      jobsMethods._apiClient = mockApiClient;

      const result = await jobsMethods.listJobs({ siteId: 'site-1' });

      expect(result.jobs).toEqual([{ id: 'j1', status: 'Success', jobType: 'refresh_extracts' }]);
    });

    it('should handle empty backgroundJobs object format', async () => {
      const mockApiClient = {
        listJobs: vi.fn().mockResolvedValue({
          pagination: { ...pagination, totalAvailable: 0 },
          backgroundJobs: {},
        }),
      };

      const jobsMethods = new JobsMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      jobsMethods._apiClient = mockApiClient;

      const result = await jobsMethods.listJobs({ siteId: 'site-1' });

      expect(result.jobs).toEqual([]);
    });

    it('should coerce numeric priority and progress fields', async () => {
      const mockApiClient = {
        listJobs: vi.fn().mockResolvedValue({
          pagination: { ...pagination, totalAvailable: 1 },
          backgroundJobs: {
            backgroundJob: { id: 'j1', priority: '50', progress: '100' },
          },
        }),
      };

      const jobsMethods = new JobsMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      jobsMethods._apiClient = mockApiClient;

      const result = await jobsMethods.listJobs({ siteId: 'site-1' });

      expect(result.jobs[0].priority).toBe(50);
      expect(result.jobs[0].progress).toBe(100);
    });

    it('should pass siteId, filter, and paging through to the API client', async () => {
      const listJobs = vi.fn().mockResolvedValue({
        pagination,
        backgroundJobs: { backgroundJob: [] },
      });
      const mockApiClient = { listJobs };

      const jobsMethods = new JobsMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      jobsMethods._apiClient = mockApiClient;

      await jobsMethods.listJobs({
        siteId: 'site-1',
        filter: 'jobType:eq:refresh_extracts',
        pageSize: 50,
        pageNumber: 2,
      });

      expect(listJobs).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { siteId: 'site-1' },
          queries: { filter: 'jobType:eq:refresh_extracts', pageSize: 50, pageNumber: 2 },
        }),
      );
    });
  });
});
