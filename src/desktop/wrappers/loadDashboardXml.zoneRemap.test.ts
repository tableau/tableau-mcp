import { Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { loadDashboardXml } from './loadDashboardXml.js';

type LoadResult = Awaited<ReturnType<typeof loadDashboardXml>>;

const signal = new AbortController().signal;
const focus = { navigate: 'none', reason: 'intermediate-leg' } as const;

const TOTAL = 'Total Revenue';
const BY_PRODUCT = 'Revenue by Product per Period';

function ws(id: number, name: string, x = 0): string {
  return `<zone id="${id}" name="${name}" x="${x}" y="0" w="50000" h="100000"/>`;
}

function dashboard(zones: string, extra = '', root = 'dashboard'): string {
  return `<${root} name="D"><zones><zone id="12" type-v2="layout-flow" param="horz" x="0" y="0" w="100000" h="100000">${zones}</zone></zones>${extra}<simple-id uuid="dash-1"/></${root}>`;
}

const live = dashboard(ws(10, TOTAL) + ws(11, BY_PRODUCT, 50000));

// Names are raw XML attribute text, registered as worksheets and dashboard viewpoints.
function workbookFor(fragment: string, names: string[]): string {
  const sheets = names
    .map(
      (n) =>
        `<worksheet name="${n}"><table><rows>[S].[sum:Sales:qk]</rows><cols/></table></worksheet>`,
    )
    .join('');
  const views = names.map((n) => `<viewpoint name="${n}"/>`).join('');
  return `<workbook><worksheets>${sheets}</worksheets><dashboards>${fragment}</dashboards><windows><window class="dashboard" name="D"><viewpoints>${views}</viewpoints></window></windows></workbook>`;
}

function executorFor(liveXml: string, names: string[]): ReturnType<typeof makeExecutorMock> {
  const ok = Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
  return makeExecutorMock({
    getWorkbookDocument: vi.fn().mockResolvedValue(Ok({ xml: workbookFor(liveXml, names) })),
    listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
    listStoryboards: vi.fn().mockResolvedValue(Ok({ storyboards: [{ id: 'dash-1', name: 'D' }] })),
    getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: liveXml })),
    getStoryboardDocument: vi.fn().mockResolvedValue(Ok({ xml: liveXml })),
    applyDashboardDocument: vi.fn().mockResolvedValue(ok),
    applyStoryboardDocument: vi.fn().mockResolvedValue(ok),
  });
}

async function run(
  submitted: string,
  kind: 'dashboard' | 'storyboard' = 'dashboard',
  liveXml = live,
  requireExistingSheet = true,
): Promise<{ result: LoadResult; executor: ReturnType<typeof makeExecutorMock> }> {
  const executor = executorFor(liveXml, [TOTAL, BY_PRODUCT, 'Other']);
  const result = await loadDashboardXml({
    dashboardName: 'D',
    xml: submitted,
    kind,
    requireExistingSheet,
    verifyReadback: false,
    focus,
    executor,
    signal,
  });
  return { result, executor };
}

function refusalMessage(result: LoadResult): string {
  const error = result.isErr() ? result.error : undefined;
  if (error?.type !== 'load-dashboard-xml-error' || error.error.type !== 'validation-failed') {
    return '';
  }
  return error.error.issues.map((issue) => issue.message).join('\n');
}

function ruleIds(result: LoadResult): string[] {
  const error = result.isErr() ? result.error : undefined;
  if (error?.type !== 'load-dashboard-xml-error' || error.error.type !== 'validation-failed') {
    return [];
  }
  return error.error.issues.map((issue) => issue.ruleId);
}

const phone = (zones: string): string =>
  `<devicelayouts><devicelayout name="Phone"><zones>${zones}</zones></devicelayout></devicelayouts>`;

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('apply-dashboard refuses an existing zone id that changes worksheets (W-24619603)', () => {
  const swapped = dashboard(ws(10, BY_PRODUCT) + ws(11, TOTAL, 50000));

  it.each([
    {
      label: '(a) names swapped, ids kept',
      xml: swapped,
      refused: true,
      match: [`Zone 10 shows "${TOTAL}"`, `puts "${BY_PRODUCT}"`, 'run-dashboard-batch'],
    },
    {
      label: '(h) A moves to a new id and B takes its zone',
      xml: dashboard(ws(10, BY_PRODUCT) + ws(13, TOTAL, 50000)),
      refused: true,
      match: [`Zone 10 shows "${TOTAL}"`, `puts "${BY_PRODUCT}"`, `moves "${TOTAL}" to zone 13`],
    },
    {
      label: '(k) A deleted and B moved into its id',
      xml: dashboard(ws(10, BY_PRODUCT)),
      refused: true,
      match: [`Zone 10 shows "${TOTAL}"`, `moves "${BY_PRODUCT}" into it from zone 11`],
    },
    {
      label: '(i) duplicate ids, swap listed first',
      xml: dashboard(ws(10, BY_PRODUCT) + ws(10, TOTAL) + ws(11, TOTAL, 50000)),
      refused: true,
      duplicate: true,
      match: [
        'has 2 zones with id="10"',
        'Desktop keeps only one zone per id and drops the others without an error.',
      ],
    },
    {
      label: '(i2) duplicate ids, swap listed last',
      xml: dashboard(ws(10, TOTAL) + ws(10, BY_PRODUCT) + ws(11, TOTAL, 50000)),
      refused: true,
      duplicate: true,
      match: [
        'has 2 zones with id="10"',
        'Desktop keeps only one zone per id and drops the others without an error.',
      ],
    },
    {
      label: '(j) pure replace: zone 10 goes from A to C and A is gone',
      xml: dashboard(ws(10, 'Other') + ws(11, BY_PRODUCT, 50000)),
      refused: false,
    },
    {
      label: '(e) container reuses a worksheet id',
      xml: dashboard(
        '<zone id="10" type-v2="layout-flow" param="vert" x="0" y="0" w="50000" h="100000"/>' +
          ws(11, BY_PRODUCT, 50000),
      ),
      refused: true,
      match: [
        'Zone 10',
        'reuses id 10 for a zone of type "layout-flow"',
        "worksheet zone's id must stay",
      ],
    },
    {
      label: '(b) nodes reordered and geometry changed, id->name kept',
      xml: dashboard(ws(11, BY_PRODUCT, 0) + ws(10, TOTAL, 50000)),
      refused: false,
    },
    {
      label: '(c) zone 11 deleted, zone 10 resized',
      xml: dashboard(`<zone id="10" name="${TOTAL}" x="0" y="0" w="100000" h="100000"/>`),
      refused: false,
    },
    {
      label: '(d) device layout reuses ids with other names',
      xml: dashboard(
        ws(10, TOTAL) + ws(11, BY_PRODUCT, 50000),
        phone(ws(10, BY_PRODUCT) + ws(11, TOTAL, 50000)),
      ),
      refused: false,
    },
    {
      label: '(d2) swap in main zones is still refused when a device layout exists',
      xml: dashboard(
        ws(10, BY_PRODUCT) + ws(11, TOTAL, 50000),
        phone(ws(10, TOTAL) + ws(11, BY_PRODUCT, 50000)),
      ),
      refused: true,
      match: ['Zone 10'],
    },
    {
      label: 'new ids are not refused',
      xml: dashboard(ws(10, TOTAL) + ws(11, BY_PRODUCT, 50000) + ws(13, 'Other', 0)),
      refused: false,
    },
  ])('$label', async ({ xml, refused, match, duplicate }) => {
    const { result, executor } = await run(xml);
    if (refused) {
      expect(result.isErr()).toBe(true);
      const message = refusalMessage(result);
      for (const part of match ?? []) expect(message).toContain(part);
      if (duplicate) {
        // The duplicate-id rule refuses before the swap check runs.
        expect(ruleIds(result)).toEqual(['dashboard-zone-id-unique']);
        expect(message).not.toContain('move their whole <zone> elements');
      } else {
        expect(message).toContain('move their whole <zone> elements');
        expect(message).not.toContain('swap their x');
        expect(message).toContain('No changes were sent to Tableau.');
      }
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    } else {
      expect(refusalMessage(result)).toBe('');
      expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
    }
  });

  it('(i3) a live duplicate the edit leaves alone does not hide a worksheet swap', async () => {
    const pair =
      '<zone id="20" type-v2="layout-flow" param="vert"/><zone id="20" type-v2="layout-flow" param="vert"/>';
    const liveWithPair = dashboard(ws(10, TOTAL) + ws(11, BY_PRODUCT, 50000) + pair);
    const executor = executorFor(liveWithPair, [TOTAL, BY_PRODUCT]);
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: dashboard(ws(10, BY_PRODUCT) + ws(11, TOTAL, 50000) + pair),
      requireExistingSheet: true,
      verifyReadback: false,
      focus,
      executor,
      signal,
    });
    expect(ruleIds(result)).not.toContain('dashboard-zone-id-unique');
    expect(refusalMessage(result)).toContain(`Zone 10 shows "${TOTAL}"`);
    expect(refusalMessage(result)).toContain('move their whole <zone> elements');
    expect(refusalMessage(result)).toContain('No changes were sent to Tableau.');
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('(f2) names compare after normalization: NFD Café is the live NFC Café', async () => {
    const nfc = 'Caf\u00e9';
    const nfd = 'Cafe\u0301';
    const executor = executorFor(dashboard(ws(10, nfc)), [nfc, 'Other']);
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: dashboard(ws(10, 'Other') + ws(13, nfd, 50000)),
      requireExistingSheet: true,
      verifyReadback: false,
      focus,
      executor,
      signal,
    });
    expect(refusalMessage(result)).toContain('moves "Caf');
    expect(refusalMessage(result)).toContain('to zone 13');
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('(g) storyboard kind skips the check', async () => {
    const { result } = await run(swapped, 'storyboard');
    expect(refusalMessage(result)).toBe('');
  });
});

describe('apply-dashboard refuses a live worksheet zone whose id changes', () => {
  const noId = (name: string, x = 0): string =>
    `<zone name="${name}" x="${x}" y="0" w="50000" h="100000"/>`;
  const container = (inner: string): string =>
    `<zone id="20" type-v2="layout-flow" param="vert" x="0" y="0" w="50000" h="100000">${inner}</zone>`;

  it.each([
    {
      label: 'both at 13',
      xml: dashboard(ws(13, TOTAL) + ws(13, BY_PRODUCT, 50000)),
      ruleId: 'dashboard-zone-id-unique',
      match: [
        'has 2 zones with id="13"',
        `"${BY_PRODUCT}", "${TOTAL}"`,
        'drops the others without an error',
      ],
    },
    {
      label: 'respelled id 010',
      xml: dashboard(ws(11, BY_PRODUCT, 50000) + `<zone id="010" name="${TOTAL}"/>`),
      ruleId: 'dashboard-zone-id-number',
      match: [`zone id="010" (${TOTAL}) is not a plain whole number`],
    },
  ])('refuses $label earlier, under $ruleId', async ({ xml, ruleId, match }) => {
    for (const requireExistingSheet of [true, false]) {
      const { result, executor } = await run(xml, 'dashboard', live, requireExistingSheet);
      expect(result.isErr()).toBe(true);
      expect(ruleIds(result)).toEqual([ruleId]);
      const message = refusalMessage(result);
      for (const part of match) expect(message).toContain(part);
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    }
  });

  it.each([
    {
      label: 'renumbered 10/11 -> 13/14',
      xml: dashboard(ws(13, TOTAL) + ws(14, BY_PRODUCT, 50000)),
      match: [`Zone 10 shows "${TOTAL}"`, `gives "${TOTAL}" id 13`],
    },
    {
      label: 'both ids removed',
      xml: dashboard(noId(TOTAL) + noId(BY_PRODUCT, 50000)),
      match: [`Zone 10 shows "${TOTAL}"`, `gives "${TOTAL}" no id`],
    },
    {
      label: 'swapped onto new ids (13 = B, 14 = A)',
      xml: dashboard(ws(13, BY_PRODUCT) + ws(14, TOTAL, 50000)),
      match: [`Zone 10 shows "${TOTAL}"`, `gives "${TOTAL}" id 14`],
    },
    {
      label: 'one renumbered, one kept',
      xml: dashboard(ws(10, TOTAL) + ws(14, BY_PRODUCT, 50000)),
      match: [`Zone 11 shows "${BY_PRODUCT}"`, `gives "${BY_PRODUCT}" id 14`],
    },
    {
      label: 'deleted and re-added under a new id',
      xml: dashboard(ws(11, BY_PRODUCT, 50000) + ws(13, TOTAL)),
      match: [`Zone 10 shows "${TOTAL}"`, `gives "${TOTAL}" id 13`],
    },
    {
      label: 'same name in NFD for a live NFC name',
      xml: dashboard(ws(11, BY_PRODUCT, 50000) + ws(13, 'Cafe\u0301')),
      liveXml: dashboard(ws(10, 'Caf\u00e9') + ws(11, BY_PRODUCT, 50000)),
      match: ['Zone 10 shows "Caf', 'id 13'],
    },
  ])('refuses $label', async ({ xml, match, liveXml }) => {
    for (const requireExistingSheet of [true, false]) {
      const { result, executor } = await run(
        xml,
        'dashboard',
        liveXml ?? live,
        requireExistingSheet,
      );
      expect(result.isErr()).toBe(true);
      expect(ruleIds(result)).toEqual(['dashboard-zone-id-change']);
      const message = refusalMessage(result);
      for (const part of match) expect(message).toContain(part);
      expect(message).toContain('keep id=');
      expect(message).toContain('leave the dashboard blank');
      expect(message).toContain('move their whole <zone> elements');
      expect(message.endsWith('No changes were sent to Tableau.')).toBe(true);
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    }
  });

  it('keeps the swap rule id and message when ids trade worksheets', async () => {
    const { result } = await run(dashboard(ws(10, BY_PRODUCT) + ws(13, TOTAL, 50000)));
    expect(ruleIds(result)).toEqual(['dashboard-zone-worksheet-swap']);
  });

  it.each([
    {
      label: 'a live zone moved into a new container with its id kept',
      xml: dashboard(container(ws(10, TOTAL)) + ws(11, BY_PRODUCT, 50000)),
      liveXml: live,
    },
    {
      label: 'a live zone with no id whose worksheet gains an id',
      xml: dashboard(ws(13, TOTAL) + ws(11, BY_PRODUCT, 50000)),
      liveXml: dashboard(noId(TOTAL) + ws(11, BY_PRODUCT, 50000)),
    },
    {
      label: 'a live zone with no id whose worksheet keeps none',
      xml: dashboard(noId(TOTAL) + ws(11, BY_PRODUCT, 50000)),
      liveXml: dashboard(noId(TOTAL) + ws(11, BY_PRODUCT, 50000)),
    },
    {
      label: 'a live id held by two live zones',
      xml: dashboard(ws(13, TOTAL) + ws(11, BY_PRODUCT, 50000)),
      liveXml: dashboard(ws(10, TOTAL) + ws(10, 'Other', 25000) + ws(11, BY_PRODUCT, 50000)),
    },
    {
      label: 'live id-less zones where the swap guard must ignore them',
      xml: dashboard(noId(BY_PRODUCT) + ws(13, TOTAL, 50000)),
      liveXml: dashboard(noId(TOTAL) + noId(BY_PRODUCT)),
    },
    {
      label: 'a worksheet listed twice, a new-id copy first and the live id second',
      xml: dashboard(ws(13, TOTAL) + ws(10, TOTAL) + ws(11, BY_PRODUCT, 50000)),
      liveXml: live,
    },
    {
      label: 'a new worksheet with a new id',
      xml: dashboard(ws(10, TOTAL) + ws(11, BY_PRODUCT, 50000) + ws(13, 'Other')),
      liveXml: live,
    },
  ])('does not refuse $label', async ({ xml, liveXml }) => {
    const { result, executor } = await run(xml, 'dashboard', liveXml);
    expect(refusalMessage(result)).toBe('');
    expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('skips the storyboard kind', async () => {
    const { result } = await run(
      dashboard(ws(13, TOTAL) + ws(14, BY_PRODUCT, 50000)),
      'storyboard',
    );
    expect(refusalMessage(result)).toBe('');
  });
});
