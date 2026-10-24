import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { loadDashboardXml } from './loadDashboardXml.js';

const signal = new AbortController().signal;
const focus = { navigate: 'none', reason: 'intermediate-leg' } as const;

const EAGER_CARD_ZONE =
  "<zone h='100000' id='8' param='[federated.csv040059ff380b040059ff380b].[none:product_line:nk]' type-v2='filter' w='20000' x='80000' y='0' />";

function fixture(
  phoneOnly: boolean,
  blank: boolean,
  zoneXml = '<zone id="1" name="A" type-v2="worksheet"/>',
): {
  executor: ReturnType<typeof makeExecutorMock>;
  fragment: string;
  live: () => string;
} {
  const zone = zoneXml;
  const fragment = `<dashboard name="D"><zones>${phoneOnly ? '' : zone}</zones>${phoneOnly ? `<devicelayouts><devicelayout name="Phone"><zones>${zone}</zones></devicelayout></devicelayouts>` : ''}<simple-id uuid="dash-1"/></dashboard>`;
  let live = `<workbook><worksheets><worksheet name="A"><table><rows>${blank ? '' : '[Superstore].[sum:Sales:qk]'}</rows><cols/></table></worksheet></worksheets><dashboards>${fragment}</dashboards><windows><window class="dashboard" name="D"><viewpoints><viewpoint name="A"/></viewpoints></window></windows></workbook>`;
  const executor = makeExecutorMock({
    getWorkbookDocument: vi.fn().mockImplementation(async () => Ok({ xml: live })),
    listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
    getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: fragment })),
    applyDashboardDocument: vi.fn().mockImplementation(async (_id: string, xml: string) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(live, 'text/xml');
      const existing = doc.getElementsByTagName('dashboard')[0];
      existing.parentNode!.replaceChild(
        doc.importNode(parser.parseFromString(xml, 'text/xml').documentElement!, true),
        existing,
      );
      live = new XMLSerializer().serializeToString(doc);
      return Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
    }),
  });
  return { executor, fragment, live: () => live };
}

const modes = [
  { requireExistingSheet: true, verifyReadback: false },
  { requireExistingSheet: true, verifyReadback: true },
  { requireExistingSheet: false, verifyReadback: true },
];

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('non-waivable dashboard worksheet-zone crash guard', () => {
  it.each(
    modes.flatMap((mode) =>
      [false, true].flatMap((phoneOnly) =>
        [false, true].map((blank) => ({ ...mode, phoneOnly, blank })),
      ),
    ),
  )('rejects a pre-existing hazard before dispatch: %j', async ({ phoneOnly, blank, ...mode }) => {
    const { executor, fragment, live } = fixture(phoneOnly, blank);
    const before = live();
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment,
      worksheetNames: ['A'],
      ...mode,
      focus,
      executor,
      signal,
    });
    expect(result).toMatchObject({
      error: {
        type: 'load-dashboard-xml-error',
        error: {
          type: 'validation-failed',
          issues: [expect.objectContaining({ ruleId: 'dashboard-worksheet-zone-type' })],
        },
      },
    });
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    expect(executor.executeCommand).not.toHaveBeenCalled();
    expect(live()).toBe(before);
  });

  it.each([false, true])(
    'permits removal of the unsafe attribute and verifies the repair (Phone-only=%s)',
    async (phoneOnly) => {
      const { executor, fragment, live } = fixture(phoneOnly, false);
      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: fragment.replace(' type-v2="worksheet"', ''),
        worksheetNames: ['A'],
        requireExistingSheet: true,
        verifyReadback: true,
        focus,
        executor,
        signal,
      });
      expect(result.isErr() ? result.error : undefined).toBeUndefined();
      expect(result.unwrap().verifiedWorksheetNames).toEqual(['A']);
      expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      expect(live()).not.toContain('type-v2="worksheet"');
    },
  );

  it('accepts the repaired zone without populating its registered blank worksheet', async () => {
    const { executor, fragment, live } = fixture(false, true);
    const before = new DOMParser()
      .parseFromString(live(), 'text/xml')
      .getElementsByTagName('worksheet')[0];
    const result = await loadDashboardXml({
      dashboardName: 'D',
      xml: fragment.replace(' type-v2="worksheet"', ''),
      requireExistingSheet: true,
      verifyReadback: true,
      focus,
      executor,
      signal,
    });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().verifiedWorksheetNames).toEqual(['A']);
    expect(executor.applyDashboardDocument).toHaveBeenCalledOnce();
    expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    const after = new DOMParser()
      .parseFromString(live(), 'text/xml')
      .getElementsByTagName('worksheet')[0];
    expect(new XMLSerializer().serializeToString(after)).toBe(
      new XMLSerializer().serializeToString(before),
    );
  });
});

describe('non-waivable nameless card zone crash guard', () => {
  const cardZones = `<zone id="1" name="A"/><zone type-v2="layout-flow" param="horz" id="2">${EAGER_CARD_ZONE}</zone>`;

  it.each(modes.flatMap((mode) => [false, true].map((phoneOnly) => ({ ...mode, phoneOnly }))))(
    'rejects a nameless filter zone before dispatch: %j',
    async ({ phoneOnly, ...mode }) => {
      const { executor, fragment, live } = fixture(phoneOnly, false, cardZones);
      const before = live();
      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: fragment,
        worksheetNames: ['A'],
        ...mode,
        focus,
        executor,
        signal,
      });
      expect(result).toMatchObject({
        error: {
          type: 'load-dashboard-xml-error',
          error: {
            type: 'validation-failed',
            issues: [expect.objectContaining({ ruleId: 'dashboard-card-zone-name' })],
          },
        },
      });
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      expect(executor.executeCommand).not.toHaveBeenCalled();
      expect(live()).toBe(before);
    },
  );
});

describe('non-waivable zone id spelling crash guard', () => {
  const liveZones =
    '<zone id="5" name="Total Revenue"/><zone id="6" name="Revenue by Product per Period"/>';
  const names = ['Total Revenue', 'Revenue by Product per Period'];
  const shapes = [
    {
      shape: 'lzswap50',
      zones:
        '<zone id="05" name="Revenue by Product per Period"/><zone id="06" name="Total Revenue"/>',
    },
    {
      shape: 'lz50',
      zones:
        '<zone id="05" name="Total Revenue"/><zone id="06" name="Revenue by Product per Period"/>',
    },
  ];
  const named = [
    { ...modes[0], label: 'cached' },
    { ...modes[1], label: 'cached, verified' },
    { ...modes[2], label: 'uncached, verified' },
  ];

  it.each(
    (['dashboard', 'storyboard'] as const).flatMap((kind) =>
      shapes.flatMap((s) => named.map((m) => ({ ...s, ...m, kind }))),
    ),
  )(
    'rejects zone ids "05"/"06" before dispatch: $kind, $shape, $label',
    async ({ zones, requireExistingSheet, verifyReadback, kind }) => {
      const { executor, live } = fixture(false, false, liveZones);
      const before = live();
      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: `<dashboard name="D"><zones>${zones}</zones><simple-id uuid="dash-1"/></dashboard>`,
        worksheetNames: names,
        kind,
        requireExistingSheet,
        verifyReadback,
        focus,
        executor,
        signal,
      });
      expect(result).toMatchObject({
        error: {
          type: 'load-dashboard-xml-error',
          error: {
            type: 'validation-failed',
            issues: expect.arrayContaining([
              expect.objectContaining({ ruleId: 'dashboard-zone-id-number' }),
            ]),
          },
        },
      });
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      expect(executor.executeCommand).not.toHaveBeenCalled();
      expect(live()).toBe(before);
    },
  );
  it.each(named)(
    'always-blocking: refuses an unchanged live id "05" that a baseline would waive: $label',
    async ({ requireExistingSheet, verifyReadback }) => {
      const { executor, fragment, live } = fixture(false, false, '<zone id="05" name="A"/>');
      const before = live();
      const result = await loadDashboardXml({
        dashboardName: 'D',
        xml: fragment,
        worksheetNames: ['A'],
        requireExistingSheet,
        verifyReadback,
        focus,
        executor,
        signal,
      });
      expect(result).toMatchObject({
        error: {
          type: 'load-dashboard-xml-error',
          error: {
            type: 'validation-failed',
            issues: [expect.objectContaining({ ruleId: 'dashboard-zone-id-number' })],
          },
        },
      });
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(live()).toBe(before);
    },
  );
});

describe('duplicate dashboard zone id guard', () => {
  const sheet = (name: string): string =>
    `<worksheet name="${name}"><table><rows>[Superstore].[sum:Sales:qk]</rows><cols/></table></worksheet>`;
  const dash = (zones: string): string =>
    `<dashboard name="D"><zones>${zones}</zones><simple-id uuid="dash-1"/></dashboard>`;
  const workbookWith = (fragment: string): string =>
    `<workbook><worksheets>${sheet('A')}${sheet('B')}</worksheets><dashboards>${fragment}</dashboards><windows><window class="dashboard" name="D"><viewpoints><viewpoint name="A"/><viewpoint name="B"/></viewpoints></window></windows></workbook>`;

  function build(liveFragment: string): ReturnType<typeof makeExecutorMock> {
    let live = liveFragment;
    return makeExecutorMock({
      getWorkbookDocument: vi.fn().mockImplementation(async () => Ok({ xml: workbookWith(live) })),
      listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: 'D' }] })),
      getDashboardDocument: vi.fn().mockImplementation(async () => Ok({ xml: live })),
      applyDashboardDocument: vi.fn().mockImplementation(async (_id: string, xml: string) => {
        live = xml;
        return Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
      }),
    });
  }

  const apply = (
    executor: ReturnType<typeof makeExecutorMock>,
    xml: string,
    mode: (typeof modes)[number],
  ): ReturnType<typeof loadDashboardXml> =>
    loadDashboardXml({
      dashboardName: 'D',
      xml,
      worksheetNames: ['A', 'B'],
      ...mode,
      focus,
      executor,
      signal,
    });

  it.each(modes)(
    'refuses two new worksheet zones that share an id before dispatch: %j',
    async (mode) => {
      const executor = build(dash('<zone id="3" type-v2="layout-flow" param="vert"/>'));
      const result = await apply(
        executor,
        dash('<zone id="7" name="A"/><zone id="7" name="B"/>'),
        mode,
      );
      expect(result).toMatchObject({
        error: {
          type: 'load-dashboard-xml-error',
          error: {
            type: 'validation-failed',
            issues: [expect.objectContaining({ ruleId: 'dashboard-zone-id-unique' })],
          },
        },
      });
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      expect(executor.executeCommand).not.toHaveBeenCalled();
    },
  );

  it('does not refuse a live duplicate container id that the edit leaves alone (cached)', async () => {
    const liveZones =
      '<zone id="7" type-v2="layout-flow" param="horz"/><zone id="7" type-v2="layout-flow" param="vert"/>';
    const executor = build(dash(liveZones));
    const result = await apply(executor, dash(`${liveZones}<zone id="9" name="A"/>`), modes[0]);
    expect(result.isErr() ? result.error : undefined).toBeUndefined();
    expect(executor.applyDashboardDocument).toHaveBeenCalledOnce();
  });

  it('refuses an edit that adds a second copy of a live id (cached)', async () => {
    const liveZones = '<zone id="7" name="A"/>';
    const executor = build(dash(liveZones));
    const result = await apply(executor, dash(`${liveZones}<zone id="7" name="B"/>`), modes[0]);
    expect(result).toMatchObject({
      error: {
        error: {
          type: 'validation-failed',
          issues: [expect.objectContaining({ ruleId: 'dashboard-zone-id-unique' })],
        },
      },
    });
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });
});
