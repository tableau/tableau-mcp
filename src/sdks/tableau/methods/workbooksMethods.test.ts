import { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { workbooksApis } from '../apis/workbooksApi.js';
import WorkbooksMethods from './workbooksMethods.js';

describe('WorkbooksMethods', () => {
  describe('publishWorkbook', () => {
    it('POSTs a single-part multipart/mixed body containing the tsRequest XML', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: {
          workbook: {
            id: 'wb-1',
            name: 'My Workbook',
            contentUrl: 'MyWorkbook',
            showTabs: false,
            tags: {},
          },
        },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: {
          post: mockPost,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const result = await workbooksMethods.publishWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        workbookType: 'twbx',
        name: 'My Workbook',
        projectId: 'project-1',
      });

      expect(result).toMatchObject({ id: 'wb-1', name: 'My Workbook' });
      expect(mockPost).toHaveBeenCalledTimes(1);

      const [url, body, config] = mockPost.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/workbooks');
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString('utf-8')).toContain(
        '<tsRequest><workbook name="My Workbook"><project id="project-1"/></workbook></tsRequest>',
      );
      expect(body.toString('latin1')).toContain('Content-Disposition: name="request_payload"');
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
      expect(config.headers.Authorization).toBe('Bearer test');
      expect(config.params).toEqual({
        uploadSessionId: 'session-1',
        workbookType: 'twbx',
        overwrite: undefined,
      });
    });

    it('escapes XML special characters in the workbook name', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: {
          workbook: { id: 'wb-1', name: 'A & B', contentUrl: 'AB', showTabs: false, tags: {} },
        },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: {
          post: mockPost,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      await workbooksMethods.publishWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        workbookType: 'twbx',
        name: 'A & B',
        projectId: 'project-1',
      });

      const body = mockPost.mock.calls[0][1];
      expect(body.toString('utf-8')).toContain('<workbook name="A &amp; B">');
    });

    it('passes overwrite through as a query param when provided', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: {
          workbook: {
            id: 'wb-1',
            name: 'My Workbook',
            contentUrl: 'MyWorkbook',
            showTabs: false,
            tags: {},
          },
        },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: {
          post: mockPost,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      await workbooksMethods.publishWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        workbookType: 'twb',
        name: 'My Workbook',
        projectId: 'project-1',
        overwrite: true,
      });

      const config = mockPost.mock.calls[0][2];
      expect(config.params).toEqual({
        uploadSessionId: 'session-1',
        workbookType: 'twb',
        overwrite: true,
      });
    });
  });

  describe('validateUploadedWorkbook', () => {
    it('should pass siteId as a path param, uploadSessionId as a query, and an undefined body', async () => {
      const mockApiClient = {
        validateUploadedWorkbook: vi.fn().mockResolvedValue({
          timestamp: '2026-06-10T14:32:18.456Z',
          uploadId: '12345:abc',
        }),
      };

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = mockApiClient;

      await workbooksMethods.validateUploadedWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-42',
      });

      expect(mockApiClient.validateUploadedWorkbook).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          params: { siteId: 'site-1' },
          queries: { uploadSessionId: 'session-42' },
        }),
      );
    });

    it('should return a successful validation result including warnings', async () => {
      const result = {
        timestamp: '2026-06-10T14:32:18.456Z',
        uploadId: '12345:abc',
        warnings: [
          {
            severity: 'WARNING',
            message: 'Unknown map source is used',
            line: 245,
            column: 18,
            elementName: 'map',
          },
        ],
      };
      const mockApiClient = {
        validateUploadedWorkbook: vi.fn().mockResolvedValue(result),
      };

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = mockApiClient;

      const validation = await workbooksMethods.validateUploadedWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-42',
      });

      expect(validation).toEqual(result);
    });

    it('should return a validation result carrying structured errors and warnings', async () => {
      const result = {
        timestamp: '2026-06-10T14:32:18.456Z',
        errors: [
          {
            severity: 'ERROR',
            message: 'Missing required closing tag for element',
            line: 127,
            column: 5,
            elementName: 'preferences',
          },
        ],
        warnings: [
          {
            severity: 'WARNING',
            message: 'Unknown map source is used',
            line: 245,
            column: 18,
            elementName: 'map',
          },
        ],
      };
      const mockApiClient = {
        validateUploadedWorkbook: vi.fn().mockResolvedValue(result),
      };

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = mockApiClient;

      const validation = await workbooksMethods.validateUploadedWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-42',
      });

      expect(validation.errors).toEqual(result.errors);
      expect(validation.warnings).toEqual(result.warnings);
      expect(validation.uploadId).toBeUndefined();
    });

    it('should return the structured body when the API responds 422 (validation errors) instead of throwing', async () => {
      const data = {
        timestamp: '2026-06-10T14:32:18.456Z',
        errors: [
          {
            severity: 'ERROR',
            message: 'Missing required closing tag for element',
            line: 127,
            column: 5,
            elementName: 'preferences',
          },
        ],
        warnings: [],
      };
      // Zodios/axios throws on a 422. isErrorFromAlias matches this shape via the
      // endpoint's declared 422 error schema, so the method returns the body.
      const axiosError = {
        isAxiosError: true,
        config: { method: 'post', url: '/sites/site-1/workbooks/validateUploadedWorkbook' },
        response: { status: 422, data },
      };
      const mockApiClient = {
        api: workbooksApis,
        validateUploadedWorkbook: vi.fn().mockRejectedValue(axiosError),
      };

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = mockApiClient;

      const validation = await workbooksMethods.validateUploadedWorkbook({
        siteId: 'site-1',
        uploadSessionId: 'session-42',
      });

      expect(validation).toEqual(data);
    });

    it('should propagate a non-422 error (e.g. 404) instead of swallowing it', async () => {
      const axiosError = {
        isAxiosError: true,
        config: { method: 'post', url: '/sites/site-1/workbooks/validateUploadedWorkbook' },
        response: {
          status: 404,
          data: { error: { code: '404', summary: 'Not Found', detail: 'Unknown upload session' } },
        },
      };
      const mockApiClient = {
        api: workbooksApis,
        validateUploadedWorkbook: vi.fn().mockRejectedValue(axiosError),
      };

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = mockApiClient;

      await expect(
        workbooksMethods.validateUploadedWorkbook({
          siteId: 'site-1',
          uploadSessionId: 'unknown-session',
        }),
      ).rejects.toBe(axiosError);
    });
  });
});
