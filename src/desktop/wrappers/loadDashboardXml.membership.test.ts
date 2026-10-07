import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import * as validationRegistry from '../validation/registry.js';
import { sourceSha256 } from './cacheFingerprint.js';
import { dashboardMembershipMatches } from './dashboardViewpoints.js';
import { loadDashboardXml } from './loadDashboardXml.js';

const focus = { navigate: 'none', reason: 'intermediate-leg' } as const;
const signal = new AbortController().signal;
const fragment = (names: string[]): string =>
  `<dashboard name="D"><zones>${names.map((name, i) => `<zone id="${i}" name="${name}"/>`).join('')}</zones><simple-id uuid="dash-1"/></dashboard>`;

function fixture(
  names: string[] = [],
  registered = names,
  beforeWrite: (xml: string) => string = (xml) => xml,
): { executor: ReturnType<typeof makeExecutorMock>; original: string; live: () => string } {
  const original = `<workbook><worksheets>${['A', 'B'].map((name) => `<worksheet name="${name}"><table><rows>[ds].[field]</rows></table></worksheet>`).join('')}</worksheets>
    <dashboards>${fragment(names)}<dashboard name="Unrelated"><zones/></dashboard></dashboards>
    <windows><window class="dashboard" name="D"><viewpoints>${registered.map((name) => `<viewpoint name="${name}"><zoom type="standard"/></viewpoint>`).join('')}</viewpoints></window>
    <window class="dashboard" name="Unrelated"><viewpoints/></window></windows></workbook>`;
  let live = original;
  const executor = makeExecutorMock({
    listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
    getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: fragment(names) })),
    getWorkbookDocument: vi.fn().mockImplementation(async () => Ok({ xml: live })),
    applyWorkbookDocument: vi.fn().mockImplementation(async (xml: string) => {
      live = beforeWrite(live);
      live = xml;
      return Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
    }),
    applyDashboardDocument: vi.fn().mockImplementation(async (_id: string, xml: string) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(beforeWrite(live), 'text/xml');
      const dashboard = Array.from(doc.getElementsByTagName('dashboard')).find(
        (node) => node.getAttribute('name') === 'D',
      )!;
      const replacement = parser.parseFromString(xml, 'text/xml').documentElement!;
      dashboard.parentNode!.replaceChild(doc.importNode(replacement, true), dashboard);
      live = new XMLSerializer().serializeToString(doc);
      return Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
    }),
  });
  return { executor, original, live: () => live };
}

describe('dashboard membership apply', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([{ names: [] }, { names: ['A'] }])(
    'pins the snapshot instance for a create-capable apply: $names',
    async ({ names }) => {
      const { executor, live } = fixture(names);
      Object.defineProperty(executor, 'desktopInstanceId', { value: 'different-cached-instance' });
      vi.mocked(executor.getWorkbookDocument).mockImplementation(async () =>
        Ok({
          xml: live(),
          instanceId: 'snapshot-instance',
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      );
      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: fragment(names),
        focus,
        executor,
        signal,
      });
      expect(result.isOk()).toBe(true);
      expect(executor.applyWorkbookDocument).toHaveBeenCalledWith(expect.any(String), signal, {
        expectedInstanceId: 'snapshot-instance',
      });
    },
  );

  it('rejects a restarted instance during freshness checking even if its workbook XML is identical', async () => {
    const { executor, original } = fixture(['A']);
    vi.mocked(executor.getWorkbookDocument)
      .mockResolvedValueOnce(
        Ok({
          xml: original,
          instanceId: 'before-restart',
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      )
      .mockResolvedValue(
        Ok({
          xml: original,
          instanceId: 'after-restart',
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      );
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({ error: { error: { type: 'source-drift' } } });
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('passes the original pin through dispatch and propagates a restart rejection without retrying', async () => {
    const { executor, original } = fixture(['A']);
    vi.mocked(executor.getWorkbookDocument).mockResolvedValue(
      Ok({
        xml: original,
        instanceId: 'snapshot-instance',
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
      }),
    );
    const restartError = {
      type: 'command-failed',
      error: { code: 'instance-mismatch', message: 'Desktop restarted', recoverable: false },
    } as const;
    vi.mocked(executor.applyWorkbookDocument).mockImplementation(async (_xml, _signal, options) => {
      expect(options?.expectedInstanceId).toBe('snapshot-instance');
      return Err(restartError);
    });
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({ error: { type: 'execute-command-error', error: restartError } });
    expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it.each(['Phone layout', 'retained settings', 'Desktop instance'])(
    'reports uncertain after accepted apply loses %s',
    async (loss) => {
      vi.useFakeTimers();
      const { executor, original, live } = fixture(['A']);
      const xml = fragment(['A']).replace(
        '<simple-id',
        '<devicelayouts><devicelayout name="Phone"><zones><zone id="4" name="A"/></zones></devicelayout></devicelayouts><simple-id',
      );
      vi.mocked(executor.getWorkbookDocument)
        .mockResolvedValueOnce(
          Ok({
            xml: original,
            instanceId: 'snapshot-instance',
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
          }),
        )
        .mockResolvedValueOnce(
          Ok({
            xml: original,
            instanceId: 'snapshot-instance',
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
          }),
        )
        .mockImplementation(async () =>
          Ok({
            xml:
              loss === 'Phone layout'
                ? live().replace(/<devicelayouts>[\s\S]*?<\/devicelayouts>/, '')
                : loss === 'retained settings'
                  ? live().replace('type="standard"', 'type="entire-view"')
                  : live(),
            instanceId: loss === 'Desktop instance' ? 'restarted-instance' : 'snapshot-instance',
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
          }),
        );
      const pending = loadDashboardXml({ dashboardName: 'D', xml, focus, executor, signal });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result).toMatchObject({
        error: {
          error: {
            type: 'verification-failed',
            message: expect.stringContaining('Changes may have been applied'),
          },
        },
      });
      expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(1);
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    },
  );

  it('waits for layout and settings to settle before returning verified registrations', async () => {
    vi.useFakeTimers();
    const { executor, original, live } = fixture(['A']);
    vi.mocked(executor.getWorkbookDocument)
      .mockResolvedValueOnce(
        Ok({ xml: original, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      )
      .mockResolvedValueOnce(
        Ok({ xml: original, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      )
      .mockImplementationOnce(async () =>
        Ok({
          xml: live().replace('type="standard"', 'type="entire-view"'),
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      )
      .mockImplementation(async () =>
        Ok({ xml: live(), applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
    const pending = loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      focus,
      executor,
      signal,
    });
    await vi.runAllTimersAsync();
    expect((await pending).unwrap().verifiedWorksheetNames).toEqual(['A']);
    expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(4);
    expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('checks the changed dashboard without running the workbook registry over a wide datasource', async () => {
    const { executor, original } = fixture([], ['A']);
    const columns = Array.from(
      { length: 5_000 },
      (_, i) => `<column name="[Field ${i}]" datatype="string" role="dimension" type="nominal"/>`,
    ).join('');
    const wide = original.replace(
      '<workbook>',
      `<workbook><datasources><datasource name="Wide">${columns}</datasource></datasources>`,
    );
    vi.mocked(executor.getWorkbookDocument)
      .mockResolvedValueOnce(
        Ok({ xml: wide, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      )
      .mockResolvedValueOnce(
        Ok({ xml: wide, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
    const validation = vi.spyOn(validationRegistry, 'runValidation');
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      focus,
      executor,
      signal,
    });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().verifiedWorksheetNames).toEqual(['A']);
    expect(validation.mock.calls.some(([, context]) => context === 'workbook')).toBe(false);
  });
  it('does not resubmit existing workbook actions when adding a worksheet zone', async () => {
    const { executor, original } = fixture([], ['A']);
    const withActions = original.replace(
      '<workbook>',
      '<workbook><actions><action name="Existing"/></actions>',
    );
    vi.mocked(executor.getWorkbookDocument)
      .mockResolvedValueOnce(
        Ok({ xml: withActions, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      )
      .mockResolvedValueOnce(
        Ok({ xml: withActions, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result.isOk()).toBe(true);
    expect(vi.mocked(executor.applyDashboardDocument).mock.calls[0][1]).not.toContain('<actions');
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });
  it.each([
    { before: [], after: ['A'] },
    { before: ['A'], after: ['B'] },
    { before: ['A', 'B'], after: ['B'] },
    { before: ['A'], after: [] },
  ])(
    'changes only the dashboard when required views already exist: $before -> $after',
    async ({ before, after }) => {
      const { executor, live } = fixture(before, [...new Set([...before, ...after])]);
      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: fragment(after),
        requireExistingSheet: true,
        focus,
        executor,
        signal,
      });
      expect(result.isOk()).toBe(true);
      expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      expect(dashboardMembershipMatches(live(), 'D', after)).toBe(true);
      expect(live()).toContain('name="Unrelated"');
      expect(live()).toContain('uuid="dash-1"');
    },
  );

  it.each([{ before: [] }, { before: ['A'] }])(
    'rejects missing registrations without a whole-workbook fallback (existing zones: $before)',
    async ({ before }) => {
      const { executor, original, live } = fixture(before, []);
      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: fragment(['A']),
        requireExistingSheet: true,
        focus,
        executor,
        signal,
      });
      expect(result).toMatchObject({
        error: { error: { type: 'registration-required', worksheetNames: ['A'] } },
      });
      expect(live()).toBe(original);
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    },
  );

  it('keeps ordinary layout edits on the per-dashboard route', async () => {
    const { executor } = fixture(['A']);
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']).replace('id="0"', 'id="7"'),
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result.isOk()).toBe(true);
    expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects stale cached fragments before either write', async () => {
    const { executor } = fixture([]);
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      expectedSourceHash: sourceSha256('stale'),
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({ error: { error: { type: 'source-drift' } } });
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('preserves unrelated Desktop edits made after the last read, at the actual POST boundary', async () => {
    const { executor, live } = fixture([], ['A'], (xml) =>
      xml
        .replaceAll('Unrelated', 'Renamed by user')
        .replace(
          '</worksheets>',
          '<worksheet name="Created concurrently"><table/></worksheet></worksheets>',
        ),
    );
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result.isOk()).toBe(true);
    expect(live()).toContain('name="Renamed by user"');
    expect(live()).toContain('name="Created concurrently"');
    expect(dashboardMembershipMatches(live(), 'D', ['A'])).toBe(true);
    expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('does not claim success when the accepted write cannot be read back', async () => {
    const { executor, original } = fixture([]);
    vi.mocked(executor.getWorkbookDocument)
      .mockResolvedValueOnce(
        Ok({ xml: original, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      )
      .mockResolvedValueOnce(
        Ok({ xml: original, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      )
      .mockResolvedValue(Err({ type: 'invalid-response', error: new Error('read failed') }));
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      requireExistingSheet: false,
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({ error: { error: { type: 'verification-failed' } } });
    expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });
});
