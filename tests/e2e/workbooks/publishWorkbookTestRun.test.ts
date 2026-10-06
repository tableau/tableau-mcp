import { getRestFailureDiagnostic, PublishWorkbookTestRun } from './publishWorkbookTestRun.js';

describe('PublishWorkbookTestRun', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('isolates concurrent runs, including an explicit workbook name override', () => {
    vi.stubEnv('GITHUB_RUN_ID', '123');
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');
    const first = new PublishWorkbookTestRun('Custom workbook', 'project-id');
    const second = new PublishWorkbookTestRun('Custom workbook', 'project-id');

    expect(first.name('TWB')).toContain(`123-2-node${process.versions.node.split('.')[0]}-`);
    expect(first.name('TWB')).not.toBe(second.name('TWB'));
    expect(first.name('TWB')).not.toBe(first.name('TWBX'));
  });

  it('deletes only IDs returned for this run and project, including repeated cleanup', async () => {
    const run = new PublishWorkbookTestRun('Publish E2E', 'project-id');
    const otherRun = new PublishWorkbookTestRun('Publish E2E', 'project-id');
    const name = run.name('TWB');
    const remove = vi.fn().mockResolvedValue(undefined);

    expect(() =>
      run.track({ id: 'foreign', name: otherRun.name('TWB'), project: { id: 'project-id' } }),
    ).toThrow();
    expect(() => run.track({ id: 'wrong-project', name, project: { id: 'other' } })).toThrow();
    expect(() => run.track({ id: 'unknown-project', name })).toThrow();
    run.track({ id: 'created-here', name, project: { id: 'project-id' } });

    await run.cleanup(remove);
    await run.cleanup(remove);

    expect(remove.mock.calls).toEqual([['created-here']]);
    expect(run.hasPublishedWorkbooks).toBe(false);
  });

  it('attempts all owned IDs and reports cleanup failures without losing failed IDs', async () => {
    const run = new PublishWorkbookTestRun('Publish E2E', 'project-id');
    run.track({ id: 'twb', name: run.name('TWB'), project: { id: 'project-id' } });
    run.track({ id: 'twbx', name: run.name('TWBX'), project: { id: 'project-id' } });
    const remove = vi.fn().mockRejectedValueOnce(new Error('403')).mockResolvedValue(undefined);

    await expect(run.cleanup(remove)).rejects.toThrow('twb: 403');
    expect(remove.mock.calls).toEqual([['twb'], ['twbx']]);
    expect(run.hasPublishedWorkbooks).toBe(true);

    remove.mockClear();
    await run.cleanup(remove);
    expect(remove.mock.calls).toEqual([['twb']]);
  });
});

describe('getRestFailureDiagnostic', () => {
  it('retains Tableau error details without dumping headers, URLs, or other response data', () => {
    const notification = {
      notifier: 'rest-api',
      message: {
        type: 'response',
        requestId: 2,
        status: 403,
        url: 'https://example.com/sensitive-path',
        headers: { Authorization: 'do-not-log' },
        data: {
          credentials: 'do-not-log',
          error: { code: '403', summary: 'Forbidden', detail: 'Publish was refused.' },
        },
      },
    };

    expect(JSON.parse(getRestFailureDiagnostic(JSON.stringify(notification))!)).toEqual({
      requestId: 2,
      status: 403,
      code: '403',
      summary: 'Forbidden',
      detail: 'Publish was refused.',
    });
    expect(getRestFailureDiagnostic(notification)).toBe(
      getRestFailureDiagnostic(JSON.stringify(notification)),
    );
  });

  it.each([
    'not JSON',
    null,
    { notifier: 'rest-api', message: { type: 'request', headers: { Authorization: 'hidden' } } },
    { notifier: 'rest-api', message: { type: 'response', requestId: 1, status: 200, data: {} } },
  ])('ignores malformed, request, and successful notifications: %j', (data) => {
    expect(getRestFailureDiagnostic(data)).toBeUndefined();
  });
});
