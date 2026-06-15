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

    it('should return an empty jobs array when the API returns no jobs', async () => {
      // _apiClient.listJobs returns the post-Zodios-transform shape, where the
      // empty-result case is already normalized to { backgroundJob: [] }.
      const mockApiClient = {
        listJobs: vi.fn().mockResolvedValue({
          pagination: { ...pagination, totalAvailable: 0 },
          backgroundJobs: { backgroundJob: [] },
        }),
      };

      const jobsMethods = new JobsMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      jobsMethods._apiClient = mockApiClient;

      const result = await jobsMethods.listJobs({ siteId: 'site-1' });

      expect(result.jobs).toEqual([]);
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
