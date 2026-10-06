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
  afterEach(() => vi.restoreAllMocks());

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
