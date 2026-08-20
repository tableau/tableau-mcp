import { PublishedWorkbook } from '../../../sdks/tableau/methods/publishingMethods.js';
import {
  buildPublishActor,
  emitPublishAudit,
  mapPersonalSpacePublishError,
  toPublishResult,
  toWorkbookViewsUrl,
} from './publishShared.js';

const mocks = vi.hoisted(() => ({ mockLog: vi.fn() }));

vi.mock('../../../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../logging/logger.js')>();
  return { ...actual, log: mocks.mockLog };
});

import { getMockRequestHandlerExtra } from '../toolContext.mock.js';

describe('buildPublishActor', () => {
  it('derives the actor from server-verified extra signals only', () => {
    const extra = getMockRequestHandlerExtra();
    const actor = buildPublishActor(extra);
    expect(actor).toEqual({
      username: undefined,
      userLuid: 'test-user-luid',
      siteLuid: 'test-site-luid',
      siteName: 'tc25',
    });
  });
});

describe('toWorkbookViewsUrl', () => {
  it('appends the /views segment to a bare workbook URL', () => {
    expect(toWorkbookViewsUrl('http://patrickgr-wsw10:8080/#/workbooks/19')).toBe(
      'http://patrickgr-wsw10:8080/#/workbooks/19/views',
    );
  });

  it('is site-path agnostic', () => {
    expect(toWorkbookViewsUrl('https://x.tableau.com/#/site/tc25/workbooks/42')).toBe(
      'https://x.tableau.com/#/site/tc25/workbooks/42/views',
    );
  });

  it('is idempotent when the URL already ends in /views', () => {
    expect(toWorkbookViewsUrl('http://host/#/workbooks/19/views')).toBe(
      'http://host/#/workbooks/19/views',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(toWorkbookViewsUrl('http://host/#/workbooks/19/')).toBe(
      'http://host/#/workbooks/19/views',
    );
  });
});

describe('toPublishResult', () => {
  const published = (overrides: Partial<PublishedWorkbook> = {}): PublishedWorkbook =>
    ({
      id: 'wb-123',
      name: 'My Viz',
      contentUrl: 'MyViz',
      webpageUrl: 'https://test.tableau.com/#/workbooks/wb-123',
      ...overrides,
    }) as PublishedWorkbook;

  it('surfaces the /views URL on `url` and keeps webpageUrl verbatim', () => {
    const result = toPublishResult(published(), {
      location: 'project',
      id: 'proj-1',
      name: 'Default',
    });
    expect(result.url).toBe('https://test.tableau.com/#/workbooks/wb-123/views');
    expect(result.webpageUrl).toBe('https://test.tableau.com/#/workbooks/wb-123');
  });

  it('links `url` to the first view (opening sheet) when the publish response carries views', () => {
    const result = toPublishResult(
      published({
        views: {
          view: [
            { id: 'v1', name: 'Overview', contentUrl: 'MyViz/sheets/Overview' },
            { id: 'v2', name: 'Detail', contentUrl: 'MyViz/sheets/Detail' },
          ],
        },
      } as Partial<PublishedWorkbook>),
      { location: 'project', id: 'proj-1', name: 'Default' },
      'https://test.tableau.com',
      'tc25',
    );
    // /sheets/ is stripped and the named-site route is used; NOT the workbook Views-tab URL.
    expect(result.url).toBe('https://test.tableau.com/#/site/tc25/views/MyViz/Overview');
    expect(result.webpageUrl).toBe('https://test.tableau.com/#/workbooks/wb-123');
  });

  it('links `url` to the named preferred view (the dashboard) over the first view', () => {
    const result = toPublishResult(
      published({
        views: {
          view: [
            { id: 'v1', name: 'My Viz', contentUrl: 'MyViz/sheets/MyViz' },
            { id: 'v2', name: 'My Viz Dashboard', contentUrl: 'MyViz/sheets/MyVizDashboard' },
          ],
        },
      } as Partial<PublishedWorkbook>),
      { location: 'project', id: 'proj-1', name: 'Default' },
      'https://test.tableau.com',
      'tc25',
      'My Viz Dashboard',
    );
    // The dashboard view wins even though the sheet view comes first in the list.
    expect(result.url).toBe('https://test.tableau.com/#/site/tc25/views/MyViz/MyVizDashboard');
  });

  it('falls back to the first view when the preferred view name is not present', () => {
    const result = toPublishResult(
      published({
        views: { view: [{ id: 'v1', name: 'My Viz', contentUrl: 'MyViz/sheets/MyViz' }] },
      } as Partial<PublishedWorkbook>),
      { location: 'project', id: 'proj-1', name: 'Default' },
      'https://test.tableau.com',
      'tc25',
      'My Viz Dashboard',
    );
    expect(result.url).toBe('https://test.tableau.com/#/site/tc25/views/MyViz/MyViz');
  });

  it('uses the default-site view route when siteName is empty/Default', () => {
    const result = toPublishResult(
      published({
        views: { view: [{ id: 'v1', name: 'Overview', contentUrl: 'MyViz/sheets/Overview' }] },
      } as Partial<PublishedWorkbook>),
      { location: 'project', id: 'proj-1', name: 'Default' },
      'https://test.tableau.com',
      '',
    );
    expect(result.url).toBe('https://test.tableau.com/#/views/MyViz/Overview');
  });

  it('skips views with no contentUrl and picks the first usable one', () => {
    const result = toPublishResult(
      published({
        views: {
          view: [
            { id: 'v0', name: 'Empty' },
            { id: 'v1', name: 'Overview', contentUrl: 'MyViz/sheets/Overview' },
          ],
        },
      } as Partial<PublishedWorkbook>),
      { location: 'project', id: 'proj-1' },
      'https://test.tableau.com',
      'tc25',
    );
    expect(result.url).toBe('https://test.tableau.com/#/site/tc25/views/MyViz/Overview');
  });

  it('falls back to the workbook Views tab when views are present but lack a contentUrl', () => {
    const result = toPublishResult(
      published({ views: { view: [{ id: 'v0', name: 'Empty' }] } } as Partial<PublishedWorkbook>),
      { location: 'project', id: 'proj-1' },
      'https://test.tableau.com',
      'tc25',
    );
    expect(result.url).toBe('https://test.tableau.com/#/workbooks/wb-123/views');
  });

  it('falls back to the workbook Views tab when no serverOrigin is available to build a view URL', () => {
    const result = toPublishResult(
      published({
        views: { view: [{ id: 'v1', name: 'Overview', contentUrl: 'MyViz/sheets/Overview' }] },
      } as Partial<PublishedWorkbook>),
      { location: 'project', id: 'proj-1' },
    );
    expect(result.url).toBe('https://test.tableau.com/#/workbooks/wb-123/views');
  });

  it('leaves `url` undefined when the server returned no webpageUrl', () => {
    const result = toPublishResult(published({ webpageUrl: undefined }), {
      location: 'project',
      id: 'proj-1',
    });
    expect(result.url).toBeUndefined();
    expect(result.webpageUrl).toBeUndefined();
  });

  it('shapes a personal-space target with its LUID and no project', () => {
    const result = toPublishResult(published(), { location: 'personalSpace', luid: 'ps-1' });
    expect(result).toMatchObject({ location: 'personalSpace', personalSpaceLuid: 'ps-1' });
    expect(result).not.toHaveProperty('projectId');
  });
});

describe('emitPublishAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const base = {
    tool: 'create-and-publish-workbook',
    actor: { siteLuid: 'site-1', siteName: 'tc25' },
    appId: 'a'.repeat(32),
    validationId: 'b'.repeat(32),
    digest: 'c'.repeat(64),
    workbookName: 'My Viz',
    targetType: 'project' as const,
    projectId: 'proj-1',
    showTabs: true,
    overwrite: false,
  };

  it('emits a schema-valid record on the audit logger at notice level', () => {
    emitPublishAudit({ ...base, outcome: 'published' });

    expect(mocks.mockLog).toHaveBeenCalledTimes(1);
    const entry = mocks.mockLog.mock.calls[0][0];
    expect(entry.logger).toBe('audit');
    expect(entry.level).toBe('notice');
    expect(entry.message).toBe('publish-audit');
    expect(entry.data).toMatchObject({
      schemaVersion: 1,
      tool: 'create-and-publish-workbook',
      appId: base.appId,
      validationId: base.validationId,
      digest: base.digest,
      projectId: 'proj-1',
      showTabs: true,
      overwrite: false,
      outcome: 'published',
    });
    expect(typeof entry.data.timestamp).toBe('string');
  });

  it('records a failure outcome with a bounded classification only', () => {
    emitPublishAudit({ ...base, outcome: 'failed', failureCode: 'publish-workbook-failed' });
    const entry = mocks.mockLog.mock.calls[0][0];
    expect(entry.data.outcome).toBe('failed');
    expect(entry.data.failureCode).toBe('publish-workbook-failed');
    expect(entry.data).not.toHaveProperty('failureDetail');
  });

  it('never carries bytes, file contents, or tokens', () => {
    emitPublishAudit({ ...base, outcome: 'published' });
    const serialized = JSON.stringify(mocks.mockLog.mock.calls[0][0]);
    expect(serialized).not.toContain('fileContents');
    expect(serialized).not.toContain('bytes');
    expect(serialized.toLowerCase()).not.toContain('token');
  });

  it('never throws when schema validation rejects a malformed record', () => {
    expect(() =>
      emitPublishAudit({ ...base, outcome: 'sideways' as unknown as 'published' }),
    ).not.toThrow();
    expect(mocks.mockLog).not.toHaveBeenCalled();
  });

  it('never throws when the durable log sink fails', () => {
    mocks.mockLog.mockImplementationOnce(() => {
      throw new Error('audit sink unavailable with secret=do-not-leak');
    });

    expect(() => emitPublishAudit({ ...base, outcome: 'published' })).not.toThrow();
    expect(mocks.mockLog).toHaveBeenCalledTimes(1);
  });
});

describe('mapPersonalSpacePublishError', () => {
  function axios400(body: unknown): unknown {
    return Object.assign(new Error('400 Bad Request'), {
      isAxiosError: true,
      response: { status: 400, data: body },
    });
  }

  it('maps the FF-off gate (400 + code 400000 + a "personal space" detail) to a fixed, leak-free error', () => {
    const secret = 'Bearer do-not-leak';
    const mapped = mapPersonalSpacePublishError(
      axios400({
        error: {
          code: '400000',
          summary: 'Bad Request',
          detail: `Publishing a workbook directly to personal space is not enabled for this site. ${secret}`,
        },
      }),
    );

    expect(mapped).not.toBeNull();
    expect(mapped!.message).toMatch(/not enabled for this Tableau site/i);
    expect(mapped!.message).not.toContain(secret);
    expect(mapped!.message).not.toContain('directly to personal space');
  });

  it('is case-insensitive on the detail substring', () => {
    const mapped = mapPersonalSpacePublishError(
      axios400({ error: { code: '400000', detail: 'Publishing to Personal Space is disabled.' } }),
    );
    expect(mapped).not.toBeNull();
  });

  it('falls through (null) on code 400000 whose detail does NOT mention personal space', () => {
    const mapped = mapPersonalSpacePublishError(
      axios400({ error: { code: '400000', detail: "A workbook named 'X' already exists." } }),
    );
    expect(mapped).toBeNull();
  });

  it('falls through (null) on a content publishing error (code 400011)', () => {
    const mapped = mapPersonalSpacePublishError(
      axios400({
        error: { code: '400011', detail: "There was a problem publishing the file 'x'." },
      }),
    );
    expect(mapped).toBeNull();
  });

  it('falls through (null) on a non-400 status even if the code matches', () => {
    const err = Object.assign(new Error('403 Forbidden'), {
      isAxiosError: true,
      response: { status: 403, data: { error: { code: '400000', detail: 'personal space' } } },
    });
    expect(mapPersonalSpacePublishError(err)).toBeNull();
  });

  it('falls through (null) on a non-axios error', () => {
    expect(mapPersonalSpacePublishError(new Error('boom personal space'))).toBeNull();
  });

  it('falls through (null) when the 400 body is missing or malformed', () => {
    expect(mapPersonalSpacePublishError(axios400(undefined))).toBeNull();
    expect(mapPersonalSpacePublishError(axios400({ error: {} }))).toBeNull();
  });
});
