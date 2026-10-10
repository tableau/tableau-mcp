import { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import DatasourcesMethods from './datasourcesMethods.js';

function createDatasourcesMethods(mockApiClient: Record<string, unknown>): DatasourcesMethods {
  const datasourcesMethods = new DatasourcesMethods(
    'http://test',
    { type: 'Bearer', token: 'test' },
    {},
  );
  // @ts-expect-error - Mocking private property
  datasourcesMethods._apiClient = mockApiClient;
  return datasourcesMethods;
}

describe('DatasourcesMethods', () => {
  describe('publishDatasourceAsJob', () => {
    function createWithPost(mockPost: ReturnType<typeof vi.fn>): DatasourcesMethods {
      return createDatasourcesMethods({
        axios: {
          post: mockPost,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      });
    }

    it('POSTs the tsRequest XML with asJob=true and returns the job id', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { job: { id: 'job-1', mode: 'Asynchronous', type: 'PublishDatasource' } },
      });

      const result = await createWithPost(mockPost).publishDatasourceAsJob({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        datasourceType: 'tdsx',
        name: 'WAM',
        projectId: 'project-1',
        description: 'Wins & losses',
        overwrite: false,
      });

      expect(result).toEqual({ jobId: 'job-1' });
      const [url, body, config] = mockPost.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/datasources');
      expect(body.toString('utf-8')).toContain(
        '<tsRequest><datasource name="WAM" description="Wins &amp; losses">' +
          '<project id="project-1"/></datasource></tsRequest>',
      );
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
      expect(config.headers.Authorization).toBe('Bearer test');
      expect(config.params).toEqual({
        uploadSessionId: 'session-1',
        datasourceType: 'tdsx',
        overwrite: false,
        asJob: true,
      });
    });

    it('omits the description attribute when no description is given', async () => {
      const mockPost = vi.fn().mockResolvedValue({ data: { job: { id: 'job-1' } } });

      await createWithPost(mockPost).publishDatasourceAsJob({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        datasourceType: 'hyper',
        name: 'O\'Brien "Sales"',
        projectId: 'project-1',
        overwrite: true,
      });

      const [, body, config] = mockPost.mock.calls[0];
      expect(body.toString('utf-8')).toContain(
        '<datasource name="O&#39;Brien &quot;Sales&quot;"><project id="project-1"/>',
      );
      expect(body.toString('utf-8')).not.toContain('description=');
      expect(config.params).toMatchObject({ datasourceType: 'hyper', overwrite: true });
    });

    it('throws when the response has no job', async () => {
      const mockPost = vi.fn().mockResolvedValue({ data: { datasource: { id: 'ds-1' } } });

      await expect(
        createWithPost(mockPost).publishDatasourceAsJob({
          siteId: 'site-1',
          uploadSessionId: 'session-1',
          datasourceType: 'tdsx',
          name: 'WAM',
          projectId: 'project-1',
          overwrite: false,
        }),
      ).rejects.toThrow();
    });
  });

  describe('queryDatasourcePermissions', () => {
    it('returns the grantee capabilities, defaulting to an empty array', async () => {
      const granteeCapabilities = [
        {
          group: { id: 'group-1', name: 'All Users' },
          capabilities: { capability: [{ name: 'Read', mode: 'Allow' }] },
        },
      ];
      const queryDatasourcePermissions = vi
        .fn()
        .mockResolvedValueOnce({ permissions: { granteeCapabilities } })
        .mockResolvedValueOnce({ permissions: {} });
      const datasourcesMethods = createDatasourcesMethods({ queryDatasourcePermissions });

      expect(
        await datasourcesMethods.queryDatasourcePermissions({
          siteId: 'site-1',
          datasourceId: 'ds-1',
        }),
      ).toEqual(granteeCapabilities);
      expect(
        await datasourcesMethods.queryDatasourcePermissions({
          siteId: 'site-1',
          datasourceId: 'ds-1',
        }),
      ).toEqual([]);
      expect(queryDatasourcePermissions).toHaveBeenCalledWith(
        expect.objectContaining({ params: { siteId: 'site-1', datasourceId: 'ds-1' } }),
      );
    });
  });
});
