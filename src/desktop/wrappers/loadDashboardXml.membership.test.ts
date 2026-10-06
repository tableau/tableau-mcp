import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
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
      live = xml;
      return Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
    }),
    applyDashboardDocument: vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'apply', status: 'completed', submitted_at: '' })),
  });
  return { executor, original, live: () => live };
}

describe('dashboard membership apply', () => {
  it('does not resubmit existing workbook actions when adding a worksheet zone', async () => {
    const { executor, original } = fixture([]);
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
    expect(vi.mocked(executor.applyWorkbookDocument).mock.calls[0][0]).not.toContain('<actions');
  });
  it.each([
    { before: [], after: ['A'] },
    { before: ['A'], after: ['B'] },
    { before: ['A', 'B'], after: ['B'] },
    { before: ['A'], after: [] },
  ])('atomically changes zones and registrations: $before -> $after', async ({ before, after }) => {
    const { executor, live } = fixture(before);
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(after),
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result.isOk()).toBe(true);
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(dashboardMembershipMatches(live(), 'D', after)).toBe(true);
    expect(live()).toContain('name="Unrelated"');
    expect(live()).toContain('uuid="dash-1"');
  });

  it('repairs missing registrations for already-populated worksheet zones', async () => {
    const { executor, live } = fixture(['A'], []);
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result.isOk()).toBe(true);
    expect(dashboardMembershipMatches(live(), 'D', ['A'])).toBe(true);
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });

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

  it('rejects intervening workbook edits instead of overwriting them', async () => {
    const { executor, original } = fixture([]);
    vi.mocked(executor.getWorkbookDocument)
      .mockResolvedValueOnce(
        Ok({ xml: original, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      )
      .mockResolvedValue(
        Ok({
          xml: original.replace('Unrelated', 'Renamed'),
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      );
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment(['A']),
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({ error: { error: { type: 'source-drift' } } });
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
      requireExistingSheet: true,
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({ error: { error: { type: 'verification-failed' } } });
    expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });
});
