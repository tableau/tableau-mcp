import { AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

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

    it('escapes an apostrophe in the workbook name as the numeric entity, not &apos;', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: {
          workbook: {
            id: 'wb-1',
            name: "O'Brien's Sales",
            contentUrl: 'OBriensSales',
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
        workbookType: 'twbx',
        name: "O'Brien's Sales",
        projectId: 'project-1',
      });

      const body = mockPost.mock.calls[0][1];
      expect(body.toString('utf-8')).toContain('<workbook name="O&#39;Brien&#39;s Sales">');
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

  describe('validateWorkbookAndUpload', () => {
    it('POSTs the TWB as multipart form data and parses the validation result', async () => {
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
      const mockPost = vi.fn().mockResolvedValue({ data: result });
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

      const validation = await workbooksMethods.validateWorkbookAndUpload({
        siteId: 'site-1',
        filename: 'superstore.twb',
        workbook: Buffer.from('<workbook />'),
      });

      expect(validation).toEqual(result);
      expect(mockPost).toHaveBeenCalledTimes(1);

      const [url, body, config] = mockPost.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/workbooks/validateWorkbookAndUpload');
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString('utf-8')).toContain('<workbook />');
      expect(body.toString('latin1')).toContain(
        'Content-Disposition: form-data; name="tableau_workbook"; filename="superstore.twb"',
      );
      expect(config.headers.Accept).toBe('application/json');
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
      expect(config.headers.Authorization).toBe('Bearer test');
    });

    it('returns structured validation errors from a 200 validation response', async () => {
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
      };
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: {
          post: vi.fn().mockResolvedValue({ data: result }),
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const validation = await workbooksMethods.validateWorkbookAndUpload({
        siteId: 'site-1',
        filename: 'invalid.twb',
        workbook: Buffer.from('<workbook>'),
      });

      expect(validation.errors).toEqual(result.errors);
      expect(validation.uploadId).toBeUndefined();
    });
  });

  describe('initiateFileUpload', () => {
    it('POSTs to fileUploads and returns the upload session', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1', fileSize: '0' } },
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

      const fileUpload = await workbooksMethods.initiateFileUpload({ siteId: 'site-1' });

      expect(fileUpload).toEqual({ uploadSessionId: 'session-1', fileSize: 0 });
      const [url, body, config] = mockPost.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/fileUploads');
      expect(body).toBeUndefined();
      expect(config.headers.Accept).toBe('application/json');
    });
  });

  describe('appendToFileUpload', () => {
    it('PUTs the chunk as multipart form data and returns the updated upload session', async () => {
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1', fileSize: '1024' } },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: {
          put: mockPut,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const fileUpload = await workbooksMethods.appendToFileUpload({
        siteId: 'site-1',
        uploadSessionId: 'session-1',
        filename: 'superstore.twbx',
        chunk: Buffer.from('chunk-bytes'),
      });

      expect(fileUpload).toEqual({ uploadSessionId: 'session-1', fileSize: 1024 });
      const [url, body, config] = mockPut.mock.calls[0];
      expect(url).toBe('http://test/sites/site-1/fileUploads/session-1');
      expect(body.toString('latin1')).toContain(
        'Content-Disposition: form-data; name="tableau_file"; filename="superstore.twbx"',
      );
      expect(config.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
    });
  });

  describe('uploadFileInChunks', () => {
    it('initiates a session and appends a single chunk for small content', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
      });
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
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
          put: mockPut,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const uploadSessionId = await workbooksMethods.uploadFileInChunks({
        siteId: 'site-1',
        filename: 'superstore.twbx',
        content: Buffer.from('small file content'),
      });

      expect(uploadSessionId).toBe('session-1');
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledTimes(1);
    });

    it('splits content larger than the max chunk size across multiple appends', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
      });
      const mockPut = vi.fn().mockResolvedValue({
        data: { fileUpload: { uploadSessionId: 'session-1' } },
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
          put: mockPut,
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const maxChunkBytes = 64 * 1024 * 1024;
      const content = Buffer.alloc(maxChunkBytes + 10, 'a');

      const uploadSessionId = await workbooksMethods.uploadFileInChunks({
        siteId: 'site-1',
        filename: 'superstore.twbx',
        content,
      });

      expect(uploadSessionId).toBe('session-1');
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPut).toHaveBeenCalledTimes(2);

      const firstChunkBody = mockPut.mock.calls[0][1];
      const secondChunkBody = mockPut.mock.calls[1][1];
      expect(firstChunkBody.byteLength).toBeGreaterThan(secondChunkBody.byteLength);
    });
  });
});
