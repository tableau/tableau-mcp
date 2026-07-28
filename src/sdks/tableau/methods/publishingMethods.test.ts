import { describe, expect, it, vi } from 'vitest';

import PublishingMethods from './publishingMethods.js';

function makeMethods(overrides?: {
  request?: ReturnType<typeof vi.fn>;
  getPersonalSpace?: ReturnType<typeof vi.fn>;
}): {
  methods: PublishingMethods;
  request: ReturnType<typeof vi.fn>;
  getPersonalSpace: ReturnType<typeof vi.fn>;
} {
  const request =
    overrides?.request ??
    vi.fn().mockResolvedValue({ data: { workbook: { id: 'wb-1', name: 'My Viz' } } });
  const getPersonalSpace =
    overrides?.getPersonalSpace ??
    vi.fn().mockResolvedValue({ personalSpace: { luid: 'ps-luid-1' } });

  const methods = new PublishingMethods('http://test', { type: 'Bearer', token: 'tok-123' }, {});
  // @ts-expect-error - replacing the private Zodios client with a mock
  methods._apiClient = { axios: { request }, getPersonalSpace };
  return { methods, request, getPersonalSpace };
}

function bodyText(request: ReturnType<typeof vi.fn>): string {
  return (request.mock.calls[0][0].data as Buffer).toString('utf-8');
}

const baseArgs = {
  siteId: 'site-1',
  name: 'My Viz',
  fileName: 'My Viz.twbx',
  workbookType: 'twbx' as const,
  fileContents: Buffer.from('PK fake twbx bytes'),
};

describe('PublishingMethods', () => {
  describe('publishWorkbook destination XML', () => {
    it('emits a <location type="PersonalSpace"/> destination (and no <project>) for a personal-space publish', async () => {
      const { methods, request } = makeMethods();

      await methods.publishWorkbook({
        ...baseArgs,
        location: { id: 'ps-luid-1', type: 'PersonalSpace' },
      });

      const xml = bodyText(request);
      expect(xml).toContain('<location id="ps-luid-1" type="PersonalSpace"/>');
      expect(xml).not.toContain('<project');
    });

    it('emits a <project/> destination (and no <location>) for a project publish', async () => {
      const { methods, request } = makeMethods();

      await methods.publishWorkbook({ ...baseArgs, projectId: 'proj-1' });

      const xml = bodyText(request);
      expect(xml).toContain('<project id="proj-1"/>');
      expect(xml).not.toContain('<location');
    });

    it('XML-escapes special characters in the name and destination id (injection guard)', async () => {
      const { methods, request } = makeMethods();

      await methods.publishWorkbook({
        ...baseArgs,
        name: 'A&B "<x>" O\'Brien',
        location: { id: 'ps&"<>\'', type: 'PersonalSpace' },
      });

      const xml = bodyText(request);
      // Raw special characters must never appear unescaped inside an attribute value.
      expect(xml).toContain('name="A&amp;B &quot;&lt;x&gt;&quot; O&#39;Brien"');
      expect(xml).toContain('<location id="ps&amp;&quot;&lt;&gt;&#39;" type="PersonalSpace"/>');
    });

    it('reflects showTabs in the workbook element', async () => {
      const { methods, request } = makeMethods();

      await methods.publishWorkbook({ ...baseArgs, projectId: 'proj-1', showTabs: false });

      expect(bodyText(request)).toContain('showTabs="false"');
    });
  });

  describe('publishWorkbook request shape', () => {
    it('posts multipart/mixed to the workbooks endpoint with workbookType/overwrite params and the auth header', async () => {
      const { methods, request } = makeMethods();

      await methods.publishWorkbook({ ...baseArgs, projectId: 'proj-1', overwrite: true });

      const cfg = request.mock.calls[0][0];
      expect(cfg.method).toBe('post');
      expect(cfg.url).toBe('/sites/site-1/workbooks');
      expect(cfg.params).toEqual({ workbookType: 'twbx', overwrite: 'true' });
      expect(cfg.headers['Content-Type']).toMatch(/^multipart\/mixed; boundary=/);
      expect(cfg.headers.Accept).toBe('application/json');
      expect(cfg.headers.Authorization).toBe('Bearer tok-123');
    });

    it('defaults overwrite to false', async () => {
      const { methods, request } = makeMethods();

      await methods.publishWorkbook({ ...baseArgs, projectId: 'proj-1' });

      expect(request.mock.calls[0][0].params).toMatchObject({ overwrite: 'false' });
    });

    it('returns the parsed workbook, including its recorded landing location', async () => {
      const { methods } = makeMethods({
        request: vi.fn().mockResolvedValue({
          data: {
            workbook: {
              id: 'wb-9',
              name: 'My Viz',
              location: { id: 'ps-luid-1', type: 'PersonalSpace', name: 'Personal Space' },
            },
          },
        }),
      });

      const wb = await methods.publishWorkbook({
        ...baseArgs,
        location: { id: 'ps-luid-1', type: 'PersonalSpace' },
      });

      expect(wb.id).toBe('wb-9');
      expect(wb.location?.type).toBe('PersonalSpace');
    });
  });

  describe('publishWorkbook destination XOR guard', () => {
    it('throws (and never calls axios) when both projectId and location are supplied', async () => {
      const { methods, request } = makeMethods();

      await expect(
        methods.publishWorkbook({
          ...baseArgs,
          projectId: 'proj-1',
          location: { id: 'ps-luid-1', type: 'PersonalSpace' },
        }),
      ).rejects.toThrow(/exactly one of/i);
      expect(request).not.toHaveBeenCalled();
    });

    it('throws (and never calls axios) when neither projectId nor location is supplied', async () => {
      const { methods, request } = makeMethods();

      await expect(methods.publishWorkbook({ ...baseArgs })).rejects.toThrow(/exactly one of/i);
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('getPersonalSpace', () => {
    it('returns the luid from the personalSpace response and passes the siteId through', async () => {
      const { methods, getPersonalSpace } = makeMethods();

      const result = await methods.getPersonalSpace({ siteId: 'site-1' });

      expect(result).toEqual({ luid: 'ps-luid-1' });
      expect(getPersonalSpace).toHaveBeenCalledWith(
        expect.objectContaining({ params: { siteId: 'site-1' } }),
      );
    });
  });
});
