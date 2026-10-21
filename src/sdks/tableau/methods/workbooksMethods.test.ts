import { AxiosError, AxiosInstance } from 'axios';
import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';

import WorkbooksMethods from './workbooksMethods.js';

describe('WorkbooksMethods', () => {
  describe('queryWorkbookConnections', () => {
    it('extracts each connection with its datasource id and name', async () => {
      const mockQueryWorkbookConnections = vi.fn().mockResolvedValue({
        connections: {
          connection: [
            {
              id: 'conn-1',
              type: 'sqlserver',
              datasource: { id: 'ds-1', name: 'Superstore' },
            },
            {
              id: 'conn-2',
              type: 'postgres',
              datasource: { id: 'ds-2', name: 'Orders' },
            },
          ],
        },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        queryWorkbookConnections: mockQueryWorkbookConnections,
      };

      const connections = await workbooksMethods.queryWorkbookConnections({
        siteId: 'site-1',
        workbookId: 'wb-1',
      });

      expect(connections).toEqual([
        { id: 'conn-1', type: 'sqlserver', datasource: { id: 'ds-1', name: 'Superstore' } },
        { id: 'conn-2', type: 'postgres', datasource: { id: 'ds-2', name: 'Orders' } },
      ]);
      expect(connections.map((c) => c.datasource)).toEqual([
        { id: 'ds-1', name: 'Superstore' },
        { id: 'ds-2', name: 'Orders' },
      ]);
      expect(mockQueryWorkbookConnections).toHaveBeenCalledWith({
        params: { siteId: 'site-1', workbookId: 'wb-1' },
        headers: { Authorization: 'Bearer test' },
      });
    });

    it('passes through connections that omit datasource or its name', async () => {
      const connection = [
        { id: 'conn-1', type: 'sqlserver', datasource: { id: 'ds-1' } },
        { id: 'conn-2', type: 'postgres' },
      ];
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 't' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        queryWorkbookConnections: vi.fn().mockResolvedValue({ connections: { connection } }),
      };

      expect(
        await workbooksMethods.queryWorkbookConnections({ siteId: 'site-1', workbookId: 'wb-1' }),
      ).toEqual(connection);
    });

    it('returns an empty array when the workbook has no connections', async () => {
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        queryWorkbookConnections: vi.fn().mockResolvedValue({ connections: {} }),
      };

      const connections = await workbooksMethods.queryWorkbookConnections({
        siteId: 'site-1',
        workbookId: 'wb-1',
      });

      expect(connections).toEqual([]);
    });
  });

  describe('queryWorkbookPermissions', () => {
    it('returns the grantee capabilities and calls with site/workbook params', async () => {
      const granteeCapabilities = [
        {
          user: { id: 'user-1', name: 'alice' },
          capabilities: { capability: [{ name: 'Read', mode: 'Allow' }] },
        },
        {
          group: { id: 'group-1', name: 'Analysts' },
          capabilities: {
            capability: [
              { name: 'Read', mode: 'Allow' },
              { name: 'Write', mode: 'Deny' },
            ],
          },
        },
      ];
      const mockQueryWorkbookPermissions = vi.fn().mockResolvedValue({
        permissions: { workbook: { id: 'wb-1', name: 'My Workbook' }, granteeCapabilities },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        queryWorkbookPermissions: mockQueryWorkbookPermissions,
      };

      const result = await workbooksMethods.queryWorkbookPermissions({
        siteId: 'site-1',
        workbookId: 'wb-1',
      });

      expect(result).toEqual(granteeCapabilities);
      expect(mockQueryWorkbookPermissions).toHaveBeenCalledWith({
        params: { siteId: 'site-1', workbookId: 'wb-1' },
        headers: { Authorization: 'Bearer test' },
      });
    });

    it('returns an empty array when the workbook has no grantee capabilities', async () => {
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        queryWorkbookPermissions: vi.fn().mockResolvedValue({ permissions: {} }),
      };

      expect(
        await workbooksMethods.queryWorkbookPermissions({ siteId: 'site-1', workbookId: 'wb-1' }),
      ).toEqual([]);
    });

    it('passes through grantees that omit capabilities or the user/group name', async () => {
      const granteeCapabilities = [
        { user: { id: 'user-1' } },
        {
          group: { id: 'group-1' },
          capabilities: { capability: [{ name: 'Read', mode: 'Allow' }] },
        },
      ];
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 't' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        queryWorkbookPermissions: vi
          .fn()
          .mockResolvedValue({ permissions: { granteeCapabilities } }),
      };

      expect(
        await workbooksMethods.queryWorkbookPermissions({ siteId: 'site-1', workbookId: 'wb-1' }),
      ).toEqual(granteeCapabilities);
    });
  });

  describe('updateWorkbook', () => {
    it('PUTs the new project id and returns the partial updated workbook', async () => {
      const mockUpdateWorkbook = vi.fn().mockResolvedValue({
        workbook: { id: 'wb-1', project: { id: 'project-2', name: 'Target Project' } },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        updateWorkbook: mockUpdateWorkbook,
      };

      const result = await workbooksMethods.updateWorkbook({
        siteId: 'site-1',
        workbookId: 'wb-1',
        projectId: 'project-2',
      });

      expect(result).toEqual({ id: 'wb-1', project: { id: 'project-2', name: 'Target Project' } });
      expect(mockUpdateWorkbook).toHaveBeenCalledWith(
        { workbook: { project: { id: 'project-2' } } },
        {
          params: { siteId: 'site-1', workbookId: 'wb-1' },
          headers: { Authorization: 'Bearer test' },
        },
      );
    });

    it('PUTs a PersonalSpace location when location is given', async () => {
      const mockUpdateWorkbook = vi.fn().mockResolvedValue({
        workbook: { id: 'wb-1', location: { id: 'ps-1', type: 'PersonalSpace' } },
      });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        updateWorkbook: mockUpdateWorkbook,
      };

      await workbooksMethods.updateWorkbook({
        siteId: 'site-1',
        workbookId: 'wb-1',
        location: 'ps-1',
      });

      expect(mockUpdateWorkbook).toHaveBeenCalledWith(
        { workbook: { location: { id: 'ps-1', type: 'PersonalSpace' } } },
        {
          params: { siteId: 'site-1', workbookId: 'wb-1' },
          headers: { Authorization: 'Bearer test' },
        },
      );
    });

    it('rejects when both or neither of projectId and location are given', async () => {
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      const mockUpdateWorkbook = vi.fn();
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = { updateWorkbook: mockUpdateWorkbook };

      await expect(
        workbooksMethods.updateWorkbook({
          siteId: 'site-1',
          workbookId: 'wb-1',
          projectId: 'project-2',
          location: 'ps-1',
        }),
      ).rejects.toThrow('accepts only one of `projectId` or `location`, not both');
      await expect(
        workbooksMethods.updateWorkbook({ siteId: 'site-1', workbookId: 'wb-1' }),
      ).rejects.toThrow('requires one of `projectId` or `location`');
      expect(mockUpdateWorkbook).not.toHaveBeenCalled();
    });
  });

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
      expect(url).toBe('/sites/site-1/workbooks');
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

    it('emits a <location type="PersonalSpace"/> element when publishing to a personal space', async () => {
      const mockPost = vi.fn().mockResolvedValue({
        data: {
          workbook: {
            id: 'wb-1',
            name: 'My Workbook',
            contentUrl: 'MyWorkbook',
            showTabs: false,
            tags: {},
            location: { id: 'ps-luid', type: 'PersonalSpace' },
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
        location: 'ps-luid',
      });

      expect(result.location).toEqual({ id: 'ps-luid', type: 'PersonalSpace' });
      const body = mockPost.mock.calls[0][1];
      expect(body.toString('utf-8')).toContain(
        '<tsRequest><workbook name="My Workbook"><location id="ps-luid" type="PersonalSpace"/></workbook></tsRequest>',
      );
      expect(body.toString('utf-8')).not.toContain('<project');
    });

    it('throws when both projectId and location are provided', async () => {
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: { post: vi.fn(), defaults: { baseURL: 'http://test' } } as unknown as AxiosInstance,
      };

      await expect(
        workbooksMethods.publishWorkbook({
          siteId: 'site-1',
          uploadSessionId: 'session-1',
          workbookType: 'twbx',
          name: 'My Workbook',
          projectId: 'project-1',
          location: 'ps-luid',
        }),
      ).rejects.toThrow('accepts only one of `projectId` or `location`, not both');
    });

    it('throws when neither projectId nor location is provided', async () => {
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: { post: vi.fn(), defaults: { baseURL: 'http://test' } } as unknown as AxiosInstance,
      };

      await expect(
        workbooksMethods.publishWorkbook({
          siteId: 'site-1',
          uploadSessionId: 'session-1',
          workbookType: 'twbx',
          name: 'My Workbook',
        }),
      ).rejects.toThrow('requires one of `projectId` or `location`');
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

  describe('downloadWorkbook', () => {
    const workbookId = '96a43833-27db-40b6-aa80-751efc776b9a';

    function setup(headers: Record<string, string>): {
      workbooksMethods: WorkbooksMethods;
      mockGet: ReturnType<typeof vi.fn>;
      stream: Readable;
    } {
      const stream = Readable.from([Buffer.from('<workbook />')]);
      const mockGet = vi.fn().mockResolvedValue({ data: stream, headers });
      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: { get: mockGet } as unknown as AxiosInstance,
      };
      return { workbooksMethods, mockGet, stream };
    }

    it('returns the response body as a stream with Content-Length, type, and filename', async () => {
      const { workbooksMethods, mockGet, stream } = setup({
        'content-length': '12',
        'content-type': 'application/xml',
        'content-disposition': 'attachment; filename="Superstore.twb"',
      });

      const result = await workbooksMethods.downloadWorkbook({
        siteId: 'site-1',
        workbookId,
        includeExtract: true,
      });

      expect(result).toEqual({
        content: stream,
        contentLength: 12,
        contentType: 'application/xml',
        filename: 'Superstore.twb',
      });
      const [url, config] = mockGet.mock.calls[0];
      expect(url).toBe(`/sites/site-1/workbooks/${workbookId}/content`);
      expect(config).toEqual({
        params: { includeExtract: true },
        headers: { Authorization: 'Bearer test', 'Accept-Encoding': 'identity' },
        responseType: 'stream',
      });
    });

    it('leaves contentLength undefined when Content-Length is missing or malformed', async () => {
      const cases: Array<Record<string, string>> = [
        {},
        { 'content-length': 'abc' },
        { 'content-length': '' },
      ];
      for (const headers of cases) {
        const { workbooksMethods } = setup(headers);
        const result = await workbooksMethods.downloadWorkbook({ siteId: 'site-1', workbookId });
        expect(result.contentLength).toBeUndefined();
      }
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
      expect(url).toBe('/sites/site-1/workbooks/validateWorkbookAndUpload');
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

    it('parses the validation-result body from a 422 validation-failure response', async () => {
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
      const axiosError = new AxiosError('Request failed with status code 422');
      axiosError.response = { status: 422, data: result } as AxiosError['response'];

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: {
          post: vi.fn().mockRejectedValue(axiosError),
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      const validation = await workbooksMethods.validateWorkbookAndUpload({
        siteId: 'site-1',
        filename: 'malformed.twb',
        workbook: Buffer.from('<workbook>'),
      });

      expect(validation.errors).toEqual(result.errors);
      expect(validation.uploadId).toBeUndefined();
    });

    it('rethrows the original axios error when the 422 body does not match the validation-result schema', async () => {
      // A 422 whose body is missing the required `timestamp` field (and is otherwise unrelated
      // JSON) must not be masked by a ZodError - the original axios error is rethrown.
      const malformedBody = { unexpected: 'shape', detail: 'not a validation result' };
      const axiosError = new AxiosError('Request failed with status code 422');
      axiosError.response = { status: 422, data: malformedBody } as AxiosError['response'];

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: {
          post: vi.fn().mockRejectedValue(axiosError),
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      await expect(
        workbooksMethods.validateWorkbookAndUpload({
          siteId: 'site-1',
          filename: 'malformed.twb',
          workbook: Buffer.from('<workbook>'),
        }),
      ).rejects.toBe(axiosError);
    });

    it('rethrows axios errors whose status is not 422', async () => {
      const axiosError = new AxiosError('Request failed with status code 403');
      axiosError.response = { status: 403 } as AxiosError['response'];

      const workbooksMethods = new WorkbooksMethods(
        'http://test',
        { type: 'Bearer', token: 'test' },
        {},
      );
      // @ts-expect-error - Mocking private property
      workbooksMethods._apiClient = {
        axios: {
          post: vi.fn().mockRejectedValue(axiosError),
          defaults: { baseURL: 'http://test' },
        } as unknown as AxiosInstance,
      };

      await expect(
        workbooksMethods.validateWorkbookAndUpload({
          siteId: 'site-1',
          filename: 'forbidden.twb',
          workbook: Buffer.from('<workbook />'),
        }),
      ).rejects.toBe(axiosError);
    });
  });
});
