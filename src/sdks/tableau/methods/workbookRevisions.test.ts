import WorkbooksMethods from './workbooksMethods.js';

const workbookId = '96a43833-27db-40b6-aa80-751efc776b9a';
const siteId = 'test-site';
const setup = (): {
  methods: WorkbooksMethods;
  get: ReturnType<typeof vi.fn>;
  getWorkbookRevisions: ReturnType<typeof vi.fn>;
} => {
  const methods = new WorkbooksMethods(
    'https://tableau.example',
    { type: 'Bearer', token: 'test' },
    {},
  );
  const get = vi.fn().mockResolvedValue({
    data: Buffer.from('<workbook/>'),
    headers: {
      'content-type': 'application/xml',
      'content-disposition': 'attachment; filename="Revision.twb"',
    },
  });
  const getWorkbookRevisions = vi.fn().mockResolvedValue({
    pagination: { pageSize: 1, pageNumber: 2, totalAvailable: 3 },
    revisions: { revision: [{ revisionNumber: 2 }] },
  });
  Object.defineProperty(methods, '_apiClient', { value: { axios: { get }, getWorkbookRevisions } });
  return { methods, get, getWorkbookRevisions };
};

describe('workbook revision REST methods', () => {
  it('preserves page metadata and forwards explicit pagination', async () => {
    const { methods, getWorkbookRevisions } = setup();
    expect(
      await methods.getWorkbookRevisions({ siteId, workbookId, pageNumber: 2, pageSize: 1 }),
    ).toEqual({
      pagination: { pageSize: 1, pageNumber: 2, totalAvailable: 3 },
      revisions: [{ revisionNumber: 2 }],
    });
    expect(getWorkbookRevisions).toHaveBeenCalledWith({
      params: { siteId, workbookId },
      queries: { pageSize: 1, pageNumber: 2 },
      headers: { Authorization: 'Bearer test' },
    });
  });
  it('returns an empty revision list when the response omits its optional array', async () => {
    const { methods, getWorkbookRevisions } = setup();
    getWorkbookRevisions.mockResolvedValue({
      pagination: { pageSize: 100, pageNumber: 1, totalAvailable: 0 },
      revisions: {},
    });
    expect((await methods.getWorkbookRevisions({ siteId, workbookId })).revisions).toEqual([]);
  });
  it('downloads the exact revision and preserves bytes and headers', async () => {
    const { methods, get } = setup();
    expect(
      await methods.downloadWorkbookRevision({
        siteId,
        workbookId,
        revisionNumber: 2,
        includeExtract: false,
      }),
    ).toEqual({
      content: Buffer.from('<workbook/>'),
      contentType: 'application/xml',
      filename: 'Revision.twb',
    });
    expect(get).toHaveBeenCalledWith(
      `/sites/${siteId}/workbooks/${workbookId}/revisions/2/content`,
      {
        params: { includeExtract: false },
        headers: { Authorization: 'Bearer test' },
        responseType: 'arraybuffer',
      },
    );
  });
  it.each([0, -1, 1.5, NaN, Infinity])(
    'refuses unsafe revision %s before a request',
    async (revisionNumber) => {
      const { methods, get } = setup();
      await expect(
        methods.downloadWorkbookRevision({ siteId, workbookId, revisionNumber }),
      ).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    },
  );
  it('refuses route traversal before a request', async () => {
    const { methods, get } = setup();
    await expect(
      methods.downloadWorkbookRevision({ siteId, workbookId: '../other', revisionNumber: 2 }),
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it('does not silently fall back to the current workbook when a revision fails', async () => {
    const { methods, get } = setup();
    get.mockRejectedValue(new Error('Revision unavailable'));
    await expect(
      methods.downloadWorkbookRevision({ siteId, workbookId, revisionNumber: 2 }),
    ).rejects.toThrow('Revision unavailable');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
