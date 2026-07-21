import { buildPublishActor, emitPublishAudit } from './publishShared.js';

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
