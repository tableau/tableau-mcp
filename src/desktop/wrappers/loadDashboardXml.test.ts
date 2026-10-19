import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import invariant from '../../utils/invariant.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { ParsedWindow } from '../metadata/types.js';
import * as validationRegistry from '../validation/registry.js';
import { synchronizeDashboardViewpoints } from './dashboardViewpoints.js';
import { loadDashboardXml, loadStoryboardXml } from './loadDashboardXml.js';

// Focus is a required argument at every write seam. Suites that are not about
// navigation pass the disposition that dispatches nothing.
const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;
describe('loadDashboardXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const dashboardName = 'Sales Dashboard';
  const validXml = `<dashboard name='${dashboardName}'><zones></zones></dashboard>`;

  function liveWorkbook(dashboardNames: string[], worksheetNames: string[] = ['Sheet 1']): string {
    const worksheets = worksheetNames
      .map(
        (name) =>
          `<worksheet name='${name}'><table><rows>[Sample - Superstore].[none:Category:nk]</rows><cols /></table></worksheet>`,
      )
      .join('');
    const dashboards = dashboardNames
      .map((name) => `<dashboard name='${name}'><zones /></dashboard>`)
      .join('');
    const windows = dashboardNames
      .map(
        (name) =>
          `<window class='dashboard' name='${name}'><viewpoints>${worksheetNames.map((sheet) => `<viewpoint name='${sheet}'/>`).join('')}</viewpoints></window>`,
      )
      .join('');
    return `<?xml version='1.0'?><workbook><worksheets>${worksheets}</worksheets><dashboards>${dashboards}</dashboards><windows>${windows}</windows></workbook>`;
  }

  // A goto-sheet moves the live document, so the readback the verify pass reads must
  // reflect it — otherwise the double reports a navigation that never landed.
  function withMaximizedWindow(workbookXml: string, sheetName: string): string {
    const quoteNormalized = workbookXml.replaceAll('"', "'");
    return quoteNormalized
      .replace(/ maximized='true'/g, '')
      .replace(
        new RegExp(`(<window[^>]*name='${sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}')`),
        "$1 maximized='true'",
      );
  }

  function dispatchingExecutor(workbookXml: string): {
    executor: ExternalApiToolExecutor;
    calls: Array<{
      kind: 'command' | 'apply';
      namespace?: string;
      command?: string;
      args?: Record<string, unknown>;
      xml?: string;
    }>;
  } {
    const calls: Array<{
      kind: 'command' | 'apply';
      namespace?: string;
      command?: string;
      args?: Record<string, unknown>;
      xml?: string;
    }> = [];
    const executeCommand = vi.fn(async (params: any) => {
      calls.push({
        kind: 'command',
        namespace: params.namespace,
        command: params.command,
        args: params.args,
      });
      if (params.command === 'goto-sheet') {
        liveXml = withMaximizedWindow(liveXml, String(params.args?.Sheet));
      }
      return Ok({ command_id: 'cmd-ok', status: 'completed' as const, submitted_at: '' });
    });
    let liveXml = workbookXml;
    const getWorkbookDocument = vi
      .fn()
      .mockImplementation(async () =>
        Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      calls.push({ kind: 'apply', xml });
      liveXml = xml;
      return Ok({ command_id: 'cmd-apply', status: 'completed' as const, submitted_at: '' });
    });
    return {
      executor: makeExecutorMock({
        executeCommand,
        getWorkbookDocument,
        applyWorkbookDocument,
        listDashboards: vi.fn().mockImplementation(async () =>
          Ok({
            dashboards: Array.from(
              new DOMParser()
                .parseFromString(liveXml, 'text/xml')
                .getElementsByTagName('dashboard'),
            ).map((node) => ({ id: node.getAttribute('name')!, name: node.getAttribute('name')! })),
          }),
        ),
        getDashboardDocument: vi.fn().mockImplementation(async (id: string) => {
          const node = Array.from(
            new DOMParser().parseFromString(liveXml, 'text/xml').getElementsByTagName('dashboard'),
          ).find((node) => node.getAttribute('name') === id)!;
          return Ok({ xml: new XMLSerializer().serializeToString(node) });
        }),
        applyDashboardDocument: vi.fn().mockImplementation(async (id: string, xml: string) => {
          calls.push({ kind: 'apply', xml });
          const doc = new DOMParser().parseFromString(liveXml, 'text/xml');
          const node = Array.from(doc.getElementsByTagName('dashboard')).find(
            (node) => node.getAttribute('name') === id,
          )!;
          node.parentNode!.replaceChild(
            doc.importNode(new DOMParser().parseFromString(xml, 'text/xml').documentElement!, true),
            node,
          );
          liveXml = new XMLSerializer().serializeToString(doc);
          return Ok({ command_id: 'apply', status: 'completed', submitted_at: '' });
        }),
      }),
      calls,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Malformed worksheet-zone retry', () => {
    const worksheetNames = [
      'Pipeline Trend',
      'Pipeline by Region',
      'Pipeline by Channel',
      'Pipeline by Source',
    ];
    // The reported retry added type-v2="worksheet" after Desktop rejected a
    // missing visual doc. It loaded blank zones that later crashed on removal.
    const malformedXml = `<dashboard name="${dashboardName}"><zones>
      <zone id="1" type-v2="layout-basic">
        <zone id="2" type-v2="title" />
        <zone id="3" name="Pipeline Trend" type-v2="worksheet" />
        <zone id="4" type-v2="layout-basic">
          <zone id="5" name="Pipeline by Region" type-v2="worksheet" />
          <zone id="6" name="Pipeline by Channel" type-v2="worksheet" />
          <zone id="7" name="Pipeline by Source" type-v2="worksheet" />
        </zone>
      </zone>
    </zones></dashboard>`;

    it.each([false, true])(
      'rejects malformed worksheet zones before dispatch (requireExistingSheet=%s)',
      async (requireExistingSheet) => {
        const { executor } = dispatchingExecutor(liveWorkbook([dashboardName], worksheetNames));
        vi.mocked(executor.listDashboards).mockResolvedValue(
          Ok({ dashboards: [{ id: 'dash-1', name: dashboardName, hidden: false }] }),
        );
        vi.mocked(executor.getDashboardDocument).mockResolvedValue(
          Ok({ xml: validXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        );
        vi.mocked(executor.applyDashboardDocument).mockResolvedValue(
          Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }),
        );

        const result = await loadDashboardXml({
          dashboardName,
          xml: malformedXml,
          executor,
          signal: mockSignal,
          focus: NO_FOCUS,
          requireExistingSheet,
        });

        expect(result.isErr()).toBe(true);
        invariant(result.isErr());
        invariant(result.error.type === 'load-dashboard-xml-error');
        invariant(result.error.error.type === 'validation-failed');
        expect(result.error.error.issues).toHaveLength(4);
        expect(result.error.error.issues[0]).toMatchObject({
          ruleId: 'dashboard-worksheet-zone-type',
          severity: 'error',
          message: expect.stringContaining('type-v2="worksheet"'),
          suggestion: expect.stringContaining('Remove'),
        });
        expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
        expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
        expect(executor.executeCommand).not.toHaveBeenCalled();
      },
    );

    it('applies corrected zones surgically when worksheet views are already registered', async () => {
      const correctedXml = malformedXml.replaceAll(' type-v2="worksheet"', '');
      const { executor } = dispatchingExecutor(
        synchronizeDashboardViewpoints(
          liveWorkbook([dashboardName], worksheetNames),
          dashboardName,
          worksheetNames,
        ).xml,
      );
      vi.mocked(executor.listDashboards).mockResolvedValue(
        Ok({ dashboards: [{ id: 'dash-1', name: dashboardName, hidden: false }] }),
      );
      vi.mocked(executor.getDashboardDocument).mockResolvedValue(
        Ok({ xml: validXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
      vi.mocked(executor.applyDashboardDocument).mockResolvedValue(
        Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }),
      );

      const result = await loadDashboardXml({
        dashboardName,
        xml: correctedXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
        requireExistingSheet: true,
      });

      expect(result.isOk()).toBe(true);
      expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      expect(vi.mocked(executor.applyDashboardDocument).mock.calls[0][1]).toBe(correctedXml);
    });
  });

  it('updates only the dashboard, preserving siblings and worksheets', async () => {
    const { executor, calls } = dispatchingExecutor(
      liveWorkbook(['Sales Dashboard', 'Other DB'], ['Sheet 1']),
    );

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();

    const applyCall = calls.find((c) => c.kind === 'apply');
    const applied = applyCall?.xml as string;
    expect(parseXML(applied).dashboard?.['@_name']).toBe('Sales Dashboard');
    expect(applied).not.toContain('<workbook');
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    const live = (await executor.getWorkbookDocument(mockSignal)).unwrap().xml;
    expect(live).toContain('name="Other DB"');
    expect(live).toContain('name="Sheet 1"');
  });

  it('preserves the live active worksheet and does not navigate after apply', async () => {
    const workbookXml = `<?xml version='1.0'?><workbook>
      <worksheets>
        <worksheet name='Sheet 1'><table /></worksheet>
        <worksheet name='Sheet 2'><table /></worksheet>
      </worksheets>
      <dashboards>
        <dashboard name='Sales Dashboard'><zones /></dashboard>
      </dashboards>
      <windows>
        <window class='worksheet' name='Sheet 1' />
        <window class='worksheet' name='Sheet 2' active='true' maximized='true' />
        <window class='dashboard' name='Sales Dashboard' />
      </windows>
    </workbook>`;
    const { executor, calls } = dispatchingExecutor(workbookXml);

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    const appliedXml = (await executor.getWorkbookDocument(mockSignal)).unwrap().xml;
    expect(appliedXml).toBeDefined();
    const windows = normalizeArray<ParsedWindow>(parseXML(appliedXml!).workbook?.windows?.window);
    expect(windows.map((window) => window['@_name'])).toEqual([
      'Sheet 1',
      'Sheet 2',
      'Sales Dashboard',
    ]);
    expect(windows[1]).toMatchObject({ '@_active': 'true', '@_maximized': 'true' });
    expect(windows[2]).not.toHaveProperty('@_active');
    expect(windows[2]).not.toHaveProperty('@_maximized');
    expect(calls.some((call) => call.command === 'goto-sheet')).toBe(false);
  });

  it('navigates to the dashboard it just applied when the caller names it as the artifact', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook([dashboardName]));

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      focus: { navigate: 'artifact', sheetName: dashboardName },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(
      calls.filter((call) => call.command === 'goto-sheet').map((call) => call.args?.Sheet),
    ).toEqual([dashboardName]);
  });

  it('navigates with the NFC canonical dashboard name', async () => {
    const canonicalName = 'Año';
    const callerName = canonicalName.normalize('NFD');
    const { executor, calls } = dispatchingExecutor(liveWorkbook([canonicalName]));

    const result = await loadDashboardXml({
      dashboardName: callerName,
      xml: `<dashboard name='${canonicalName}'><zones></zones></dashboard>`,
      focus: { navigate: 'artifact', sheetName: callerName },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(
      calls.filter((call) => call.command === 'goto-sheet').map((call) => call.args?.Sheet),
    ).toEqual([canonicalName]);
  });

  it('preserves referenced worksheets without resubmitting them', async () => {
    const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
    const { executor, calls } = dispatchingExecutor(
      liveWorkbook(['Sales Dashboard', 'Other DB'], ['Sheet 1']),
    );

    const result = await loadDashboardXml({
      dashboardName,
      xml: dashboardXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    const applyCall = calls.find((c) => c.kind === 'apply');
    expect(applyCall?.xml).not.toContain('<worksheet');
    expect((await executor.getWorkbookDocument(mockSignal)).unwrap().xml).toContain('<worksheet');
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    expect(applyCall?.xml).toContain("name='Sheet 1'");
  });

  it('refuses a net-new dashboard without replacing the existing workbook', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other DB']));

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result).toMatchObject({ error: { error: { type: 'sheet-absent' } } });
    expect(calls).toEqual([]);
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });

  describe('worksheet registration and locked snapshot', () => {
    function liveWorkbookWithBlankWorksheet(
      dashboardNames: string[],
      worksheetName = 'Sheet 1',
    ): string {
      const dashboards = dashboardNames
        .map((name) => `<dashboard name='${name}'><zones /></dashboard>`)
        .join('');
      const windows = dashboardNames
        .map((name) => `<window class='dashboard' name='${name}'/>`)
        .join('');
      return (
        `<?xml version='1.0'?><workbook><worksheets><worksheet name='${worksheetName}'>` +
        `<table><rows /><cols /></table></worksheet></worksheets><dashboards>${dashboards}` +
        `</dashboards><windows>${windows}</windows></workbook>`
      );
    }

    it('rejects an unregistered blank worksheet on the default route with unknown API', async () => {
      const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
      const { executor, calls } = dispatchingExecutor(
        liveWorkbookWithBlankWorksheet(['Sales Dashboard']),
      );

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        invariant(result.error.type === 'load-dashboard-xml-error');
        invariant(result.error.error.type === 'registration-required');
        expect(result.error.error.worksheetNames).toEqual(['Sheet 1']);
        expect(result.error.error.message).toContain('Sales Dashboard');
        expect(result.error.error.message).toContain('Sheet 1');
        expect(result.error.error.message).toContain(
          'Add the worksheets to this dashboard in Desktop',
        );
        expect(result.error.error.message).not.toContain('add-field');
        expect(result.error.error.message).not.toContain('apply-worksheet');
        expect(result.error.error.message).toContain('No changes were sent to Tableau');
      }
      expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
    });

    it('rejects an unregistered blank worksheet on the cached route with unknown API', async () => {
      const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
      const { executor } = dispatchingExecutor(liveWorkbookWithBlankWorksheet(['Sales Dashboard']));

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
        requireExistingSheet: true,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        invariant(result.error.type === 'load-dashboard-xml-error');
        invariant(result.error.error.type === 'registration-required');
        expect(result.error.error.worksheetNames).toEqual(['Sheet 1']);
      }
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    });

    it('lets the cached route through when the populated worksheet is registered', async () => {
      const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
      const applyDashboardDocument = vi
        .fn()
        .mockResolvedValue(
          Ok({ command_id: 'cmd-apply', status: 'completed' as const, submitted_at: '' }),
        );
      const executor = makeExecutorMock({
        getWorkbookDocument: vi.fn().mockResolvedValue(
          Ok({
            xml: synchronizeDashboardViewpoints(
              liveWorkbook(['Sales Dashboard'], ['Sheet 1']).replace(
                `<dashboard name='${dashboardName}'><zones /></dashboard>`,
                dashboardXml,
              ),
              dashboardName,
              ['Sheet 1'],
            ).xml,
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
          }),
        ),
        listDashboards: vi
          .fn()
          .mockResolvedValue(
            Ok({ dashboards: [{ id: 'dash-1', name: dashboardName, hidden: false }] }),
          ),
        getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: dashboardXml })),
        applyDashboardDocument,
      });

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
        requireExistingSheet: true,
      });

      expect(result.isOk()).toBe(true);
      expect(applyDashboardDocument).toHaveBeenCalledOnce();
    });

    it('keeps workbook namespace context during an unchanged per-sheet dashboard apply', async () => {
      const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Namespaced' /></zones></dashboard>`;
      const workbookXml = `<?xml version='1.0'?><workbook>
        <worksheets xmlns:user='urn:tableau:user' xmlns:mid='urn:intermediate'>
          <worksheet name='Namespaced'><table><view>
            <groupfilter function='level-members' level='[none:Category:nk]' user:ui-domain='relevant' user:ui-enumeration='inclusive' />
            <mid:metadata-record />
            <pane xmlns:user='urn:local'><groupfilter function='level-members' level='[none:Category:nk]' user:ui-domain='database' user:ui-enumeration='all' /></pane>
          </view><rows>[none:Category:nk]</rows><cols /></table></worksheet>
        </worksheets>
        <dashboards>${dashboardXml}</dashboards>
        <windows><window class='worksheet' name='Namespaced' /><window class='dashboard' name='${dashboardName}'><viewpoints><viewpoint name='Namespaced'/></viewpoints></window></windows>
      </workbook>`;
      const applyDashboardDocument = vi
        .fn()
        .mockResolvedValue(
          Ok({ command_id: 'cmd-apply', status: 'completed' as const, submitted_at: '' }),
        );
      const executor = makeExecutorMock({
        getWorkbookDocument: vi
          .fn()
          .mockResolvedValue(
            Ok({ xml: workbookXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
          ),
        listDashboards: vi
          .fn()
          .mockResolvedValue(
            Ok({ dashboards: [{ id: 'dash-1', name: dashboardName, hidden: false }] }),
          ),
        getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: dashboardXml })),
        applyDashboardDocument,
      });

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
        requireExistingSheet: true,
      });

      expect(result.isOk()).toBe(true);
      expect(applyDashboardDocument).toHaveBeenCalledOnce();
      expect(applyDashboardDocument.mock.calls[0]?.[1]).toBe(dashboardXml);
    });

    it.each([false, true])(
      'blocks an unregistered namespaced worksheet with unknown API (cached=%s)',
      async (requireExistingSheet) => {
        const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Namespaced Blank' /></zones></dashboard>`;
        const workbookXml = `<?xml version='1.0'?><workbook xmlns:user='urn:tableau:user'>
          <worksheets xmlns:mid='urn:intermediate'>
            <worksheet name='Namespaced Blank'><table><view>
              <groupfilter function='level-members' level='Category' user:ui-domain='relevant' user:ui-enumeration='inclusive' />
              <mid:metadata-record />
              <pane xmlns:user='urn:local'><groupfilter function='level-members' level='Category' user:ui-domain='database' user:ui-enumeration='all' /></pane>
            </view><rows /><cols /></table></worksheet>
          </worksheets>
          <dashboards><dashboard name='${dashboardName}'><zones /></dashboard></dashboards>
          <windows><window class='worksheet' name='Namespaced Blank' /></windows>
        </workbook>`;
        const applyDashboardDocument = vi.fn();
        const applyWorkbookDocument = vi.fn();
        const executor = makeExecutorMock({
          getWorkbookDocument: vi
            .fn()
            .mockResolvedValue(
              Ok({ xml: workbookXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
            ),
          listDashboards: vi
            .fn()
            .mockResolvedValue(
              Ok({ dashboards: [{ id: 'dash-1', name: dashboardName, hidden: false }] }),
            ),
          getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: dashboardXml })),
          applyDashboardDocument,
          applyWorkbookDocument,
        });

        const result = await loadDashboardXml({
          dashboardName,
          xml: dashboardXml,
          executor,
          signal: mockSignal,
          focus: NO_FOCUS,
          requireExistingSheet,
        });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          invariant(result.error.type === 'load-dashboard-xml-error');
          invariant(result.error.error.type === 'registration-required');
          expect(result.error.error.worksheetNames).toEqual(['Namespaced Blank']);
        }
        expect(applyDashboardDocument).not.toHaveBeenCalled();
        expect(applyWorkbookDocument).not.toHaveBeenCalled();
      },
    );

    it('does not collapse entity-distinct worksheet names when checking registration', async () => {
      const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='A &amp;amp; B' /></zones></dashboard>`;
      const workbookXml = `<workbook><worksheets>
        <worksheet name='A &amp; B'><table><rows>[none:First:nk]</rows><cols /></table></worksheet>
        <worksheet name='A &amp;amp; B'><table><rows /><cols /></table></worksheet>
      </worksheets><dashboards><dashboard name='${dashboardName}'><zones /></dashboard></dashboards>
      <windows><window class='dashboard' name='${dashboardName}'><viewpoints><viewpoint name='A &amp; B'/></viewpoints></window>
      <window class='worksheet' name='A &amp; B' /><window class='worksheet' name='A &amp;amp; B' /></windows></workbook>`;
      const applyWorkbookDocument = vi.fn();
      const executor = makeExecutorMock({
        getWorkbookDocument: vi
          .fn()
          .mockResolvedValue(
            Ok({ xml: workbookXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
          ),
        listDashboards: vi
          .fn()
          .mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: dashboardName }] })),
        getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: validXml })),
        applyWorkbookDocument,
      });

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        invariant(result.error.type === 'load-dashboard-xml-error');
        invariant(result.error.error.type === 'registration-required');
        expect(result.error.error.worksheetNames).toEqual(['A &amp; B']);
      }
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    });

    it("requires registration when the worksheet zone carries type-v2='visual'", async () => {
      const dashboardXml =
        `<dashboard name='${dashboardName}'><zones>` +
        "<zone name='Sheet 1' type-v2='visual' /></zones></dashboard>";
      const { executor, calls } = dispatchingExecutor(
        liveWorkbookWithBlankWorksheet(['Sales Dashboard']),
      );

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        invariant(result.error.type === 'load-dashboard-xml-error');
        invariant(result.error.error.type === 'registration-required');
        expect(result.error.error.worksheetNames).toEqual(['Sheet 1']);
      }
      expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
    });

    it('requires registration for a worksheet zone nested inside a layout container', async () => {
      // Real dashboards nest the worksheet zone under a type-v2='layout-basic' container zone.
      const dashboardXml =
        `<dashboard name='${dashboardName}'><zones>` +
        "<zone type-v2='layout-basic' x='0' y='0' w='100000' h='100000'>" +
        "<zone name='Sheet 1'><zone-pane name='pane-1' /></zone>" +
        '</zone></zones></dashboard>';
      const { executor, calls } = dispatchingExecutor(
        liveWorkbookWithBlankWorksheet(['Sales Dashboard']),
      );

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        invariant(result.error.type === 'load-dashboard-xml-error');
        invariant(result.error.error.type === 'registration-required');
        expect(result.error.error.worksheetNames).toEqual(['Sheet 1']);
      }
      expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
    });

    it('does NOT treat a named non-visual (text) zone as a worksheet, even when a blank worksheet shares its name', async () => {
      const dashboardXml =
        `<dashboard name='${dashboardName}'><zones>` +
        "<zone name='Legend' type-v2='text' /></zones></dashboard>";
      const { executor, calls } = dispatchingExecutor(
        liveWorkbookWithBlankWorksheet(['Sales Dashboard'], 'Legend'),
      );

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result.isOk()).toBe(true);
      expect(calls.find((c) => c.kind === 'apply')).toBeDefined();
    });

    function liveWorkbookWithViewpoints({
      worksheetName = 'Sheet 1',
      worksheetRendered,
      dashboardName: dbName,
      viewpoints,
    }: {
      worksheetName?: string;
      worksheetRendered: boolean;
      dashboardName: string;
      viewpoints: string;
    }): string {
      const table = worksheetRendered
        ? '<table><rows>[Sample - Superstore].[none:Category:nk]</rows><cols /></table>'
        : '<table><rows /><cols /></table>';
      return (
        "<?xml version='1.0'?><workbook>" +
        `<worksheets><worksheet name='${worksheetName}'>${table}</worksheet></worksheets>` +
        `<dashboards><dashboard name='${dbName}'><zones><zone name='${worksheetName}' /></zones></dashboard></dashboards>` +
        `<windows><window class='dashboard' name='${dbName}'>${viewpoints}</window></windows>` +
        '</workbook>'
      );
    }

    const VALID_VIEWPOINTS =
      "<viewpoints><viewpoint name='Sheet 1'><zoom type='entire-view' /></viewpoint></viewpoints>";

    it.each([undefined, '0.2.21', '0.2.22', '0.2.23'])(
      'accepts a registered blank worksheet on API %s',
      async (version) => {
        const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
        const { executor, calls } = dispatchingExecutor(
          liveWorkbookWithViewpoints({
            worksheetRendered: false,
            dashboardName,
            viewpoints: VALID_VIEWPOINTS,
          }),
        );
        Object.defineProperty(executor, 'desktopApiVersion', { value: version });

        const result = await loadDashboardXml({
          dashboardName,
          xml: dashboardXml,
          executor,
          signal: mockSignal,
          focus: NO_FOCUS,
        });

        expect(result.isOk()).toBe(true);
        expect(result.unwrap().verifiedWorksheetNames).toEqual(['Sheet 1']);
        expect(calls.find((c) => c.kind === 'apply')).toBeDefined();
        expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
        expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
        expect((await executor.getWorkbookDocument(mockSignal)).unwrap().xml).toContain(
          '<rows/><cols/>',
        );
      },
    );

    function nativeRegistrationFixture(
      version: string | undefined,
      mixed: boolean,
      repair = true,
    ): { executor: ExternalApiToolExecutor; original: string } {
      const original = liveWorkbook([dashboardName], ['Sheet 1', 'Sheet 2'])
        .replace(/<viewpoints>[\s\S]*?<\/viewpoints>/, '<viewpoints/>')
        .replace('[Sample - Superstore].[none:Category:nk]', '')
        .replace(mixed ? 'never-match' : '[Sample - Superstore].[none:Category:nk]', '');
      const { executor } = dispatchingExecutor(original);
      Object.defineProperty(executor, 'desktopApiVersion', { value: version });
      const apply = vi.mocked(executor.applyDashboardDocument).getMockImplementation()!;
      let registeredXml: string | undefined;
      const read = vi.mocked(executor.getWorkbookDocument).getMockImplementation()!;
      vi.mocked(executor.getWorkbookDocument).mockImplementation(async (...args) => {
        const result = await read(...args);
        return registeredXml
          ? Ok({ xml: registeredXml, applicationVersion: undefined, xsdPayloadVersion: undefined })
          : result;
      });
      vi.mocked(executor.applyDashboardDocument).mockImplementation(async (...args) => {
        const result = await apply(...args);
        if (repair) {
          const current = (await read(mockSignal)).unwrap().xml;
          const doc = new DOMParser().parseFromString(current, 'text/xml');
          const viewpoints = doc.getElementsByTagName('viewpoints')[0];
          for (const zone of Array.from(
            new DOMParser().parseFromString(args[1], 'text/xml').getElementsByTagName('zone'),
          )) {
            const name = zone.getAttribute('name');
            if (!name) continue;
            const viewpoint = doc.createElement('viewpoint');
            viewpoint.setAttribute('name', name);
            viewpoints.appendChild(viewpoint);
          }
          registeredXml = new XMLSerializer().serializeToString(doc);
        }
        return result;
      });
      return { executor, original };
    }

    it.each(
      ['0.2.22', '0.2.23'].flatMap((version) =>
        [false, true].flatMap((mixed) =>
          [false, true].map((cached) => ({ version, mixed, cached })),
        ),
      ),
    )(
      'native registration accepts blank/mixed sheets with mandatory readback: %j',
      async ({ version, mixed, cached }) => {
        const { executor, original } = nativeRegistrationFixture(version, mixed);
        const xml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1'/><zone name='Sheet 2'/></zones></dashboard>`;
        const result = await loadDashboardXml({
          dashboardName,
          xml,
          executor,
          signal: mockSignal,
          focus: NO_FOCUS,
          requireExistingSheet: cached,
          verifyReadback: !cached,
        });
        expect(result.isOk()).toBe(true);
        expect(result.unwrap().verifiedWorksheetNames).toEqual(['Sheet 1', 'Sheet 2']);
        expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(2);
        expect(executor.applyDashboardDocument).toHaveBeenCalledOnce();
        expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
        expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
        const sheets = (xml: string): string[] =>
          Array.from(
            new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('worksheet'),
          ).map((node) => new XMLSerializer().serializeToString(node));
        expect(sheets((await executor.getWorkbookDocument(mockSignal)).unwrap().xml)).toEqual(
          sheets(original),
        );
      },
    );

    it.each(
      [undefined, '0.2.21'].flatMap((version) =>
        [false, true].map((mixed) => ({ version, mixed })),
      ),
    )(
      'missing registration stays blocked for blank/mixed sheets on older/unknown API: %j',
      async ({ version, mixed }) => {
        const { executor } = nativeRegistrationFixture(version, mixed);
        const result = await loadDashboardXml({
          dashboardName,
          xml: `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1'/><zone name='Sheet 2'/></zones></dashboard>`,
          executor,
          signal: mockSignal,
          focus: NO_FOCUS,
        });
        expect(result).toMatchObject({
          error: {
            error: { type: 'registration-required', worksheetNames: ['Sheet 1', 'Sheet 2'] },
          },
        });
        expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
        expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
        expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      },
    );

    it('native registration does not cover extra worksheetNames outside submitted zones', async () => {
      const { executor } = nativeRegistrationFixture('0.2.22', false);
      const result = await loadDashboardXml({
        dashboardName,
        xml: `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1'/></zones></dashboard>`,
        worksheetNames: ['Sheet 2'],
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });
      expect(result).toMatchObject({
        error: { error: { type: 'registration-required', worksheetNames: ['Sheet 1', 'Sheet 2'] } },
      });
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    });

    it('requires native registration readback for blank worksheets even on cached apply', async () => {
      vi.useFakeTimers();
      try {
        const { executor } = nativeRegistrationFixture('0.2.22', false, false);
        const pending = loadDashboardXml({
          dashboardName,
          xml: `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1'/></zones></dashboard>`,
          executor,
          signal: mockSignal,
          focus: NO_FOCUS,
          requireExistingSheet: true,
        });
        await vi.runAllTimersAsync();
        expect(await pending).toMatchObject({ error: { error: { type: 'verification-failed' } } });
        expect(executor.applyDashboardDocument).toHaveBeenCalledOnce();
        expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
        expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('delegates a blank worksheet reference to the surgical storyboard endpoint', async () => {
      const xml = `<dashboard name='${dashboardName}' type='storyboard'><zones><zone name='Sheet 1'/></zones></dashboard>`;
      const executor = makeExecutorMock({
        getWorkbookDocument: vi
          .fn()
          .mockResolvedValue(Ok({ xml: liveWorkbookWithBlankWorksheet([dashboardName]) })),
        listStoryboards: vi
          .fn()
          .mockResolvedValue(Ok({ storyboards: [{ id: 'sb-1', name: dashboardName }] })),
        getStoryboardDocument: vi.fn().mockResolvedValue(Ok({ xml })),
        applyStoryboardDocument: vi
          .fn()
          .mockResolvedValue(Ok({ command_id: 'apply', status: 'completed', submitted_at: '' })),
      });
      const result = await loadStoryboardXml({
        storyboardName: dashboardName,
        xml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
        requireExistingSheet: true,
      });
      expect(result.isOk()).toBe(true);
      expect(executor.applyStoryboardDocument).toHaveBeenCalledOnce();
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
      expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    });

    it('reports missing registration, not blank worksheet, when a populated sheet has no viewpoint', async () => {
      const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
      const { executor, calls } = dispatchingExecutor(
        liveWorkbookWithViewpoints({
          worksheetRendered: true,
          dashboardName,
          viewpoints: '<viewpoints />',
        }),
      );

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result).toMatchObject({ error: { error: { type: 'registration-required' } } });
      expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
    });

    it('fails CLOSED (retriable error, no dispatch) when the live workbook read errors, so a transient read cannot silently disable the guard', async () => {
      const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
      const { executor, calls } = dispatchingExecutor(
        liveWorkbook(['Sales Dashboard'], ['Sheet 1']),
      );
      const readError = {
        type: 'command-failed' as const,
        error: { code: 'ERR', message: 'Transient', recoverable: false },
      };
      vi.mocked(executor.getWorkbookDocument).mockResolvedValueOnce(Err(readError));

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('execute-command-error');
      }
      expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(1);
      expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
    });

    it('reuses the locked snapshot and verifies the surgical apply', async () => {
      const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
      const { executor, calls } = dispatchingExecutor(
        liveWorkbook(['Sales Dashboard'], ['Sheet 1']),
      );

      const result = await loadDashboardXml({
        dashboardName,
        xml: dashboardXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result.isOk()).toBe(true);
      expect(executor.getWorkbookDocument).toHaveBeenCalledTimes(2);
      expect(calls.find((c) => c.kind === 'apply')).toBeDefined();
    });
  });

  // Resolves absent targets without a workbook fallback, regardless of the legacy flag.
  function absentDashboardExecutor(liveDashboardNames: string[]): {
    executor: ExternalApiToolExecutor;
    calls: Array<{ kind: 'command' | 'apply'; xml?: string }>;
  } {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(liveDashboardNames));
    (executor as unknown as { listDashboards: unknown }).listDashboards = vi.fn().mockResolvedValue(
      Ok({
        dashboards: liveDashboardNames.map((name, i) => ({ id: `id-${i}`, name, hidden: false })),
      }),
    );
    return { executor, calls };
  }

  it('omits a pre-existing error from cached dashboard validation warnings', async () => {
    const existingIssue = {
      ruleId: 'existing',
      severity: 'error' as const,
      message: 'already broken',
    };
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [existingIssue],
    });
    const applyDashboardDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
    const executor = makeExecutorMock({
      listDashboards: vi
        .fn()
        .mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: dashboardName }] })),
      getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: validXml })),
      applyDashboardDocument,
    });

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.validationWarnings).toEqual([]);
    expect(applyDashboardDocument).toHaveBeenCalledOnce();
  });

  it('carries Desktop document warnings and diagnostics from the dashboard apply', async () => {
    const warnings = [{ code: 'dropped-node', message: 'Removed an unsupported zone.' }];
    const diagnostics = { worksheets: [] };
    const executor = makeExecutorMock({
      listDashboards: vi
        .fn()
        .mockResolvedValue(Ok({ dashboards: [{ id: 'dash-1', name: dashboardName }] })),
      getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: validXml })),
      applyDashboardDocument: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-apply',
          status: 'completed',
          submitted_at: '',
          warnings,
          diagnostics,
        }),
      ),
    });

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.documentWarnings).toEqual(warnings);
      expect(result.value.diagnostics).toEqual(diagnostics);
    }
  });

  it('carries Desktop document warnings from a storyboard apply', async () => {
    const warnings = [{ code: 'dropped-node', message: 'Removed an unsupported point.' }];
    const executor = makeExecutorMock({
      listStoryboards: vi
        .fn()
        .mockResolvedValue(Ok({ storyboards: [{ id: 'sb-1', name: dashboardName }] })),
      getStoryboardDocument: vi.fn().mockResolvedValue(Ok({ xml: validXml })),
      applyStoryboardDocument: vi
        .fn()
        .mockResolvedValue(
          Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '', warnings }),
        ),
    });

    const result = await loadStoryboardXml({
      storyboardName: dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.documentWarnings).toEqual(warnings);
  });

  it('reports no document warnings for a clean dashboard apply', async () => {
    const { executor } = dispatchingExecutor(liveWorkbook([dashboardName]));

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.documentWarnings).toEqual([]);
  });

  it('surfaces sheet-absent (no whole-workbook fallback) when requireExistingSheet is set', async () => {
    const { executor, calls } = absentDashboardExecutor(['Some Other DB']);

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
      expect(result.error.error.type).toBe('sheet-absent');
      invariant(result.error.error.type === 'sheet-absent');
      expect(result.error.error.message).toContain('dashboard');
      expect(result.error.error.message).toContain('Sales Dashboard');
    }
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('surfaces a storyboard-scoped sheet-absent message when requireExistingSheet is set', async () => {
    const { executor, calls } = absentDashboardExecutor([]);
    (executor as unknown as { listStoryboards: unknown }).listStoryboards = vi
      .fn()
      .mockResolvedValue(Ok({ storyboards: [] }));

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      kind: 'storyboard',
      requireExistingSheet: true,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
      invariant(result.error.error.type === 'sheet-absent');
      expect(result.error.error.message).toContain('storyboard');
      // The storyboard recovery text must not steer to off-profile apply/list tools.
      expect(result.error.error.message).not.toContain('apply-');
      expect(result.error.error.message).not.toContain('list-');
    }
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('never falls back to a workbook write for an absent dashboard when requireExistingSheet is off', async () => {
    const { executor, calls } = absentDashboardExecutor(['Some Other DB']);

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result).toMatchObject({ error: { error: { type: 'sheet-absent' } } });
    expect(calls).toEqual([]);
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
  });

  // apply-dashboard/apply-storyboard are pure per-sheet applies: any non-`applied` outcome errors and
  // never falls back to the whole-workbook re-post. When the per-sheet route is unavailable
  // (a list route returning `not-found` → route-missing) it must NOT quietly
  // whole-workbook apply — even for an existing sheet.
  it('errors and never whole-workbook applies when requireExistingSheet is set and the route is missing (absent name)', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other DB']));

    vi.mocked(executor.listDashboards).mockResolvedValue(
      Err({
        type: 'command-failed',
        error: { code: 'not-found', message: 'No route matches', recoverable: false },
      }),
    );
    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
      expect(result.error.error.type).toBe('route-missing');
      invariant(result.error.error.type === 'route-missing');
      expect(result.error.error.message).not.toContain('create the dashboard');
      expect(result.error.error.message).toContain('No changes were sent');
    }
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('errors and never whole-workbook applies when requireExistingSheet is set and the route is missing (existing dashboard)', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sales Dashboard', 'Other DB']));

    vi.mocked(executor.listDashboards).mockResolvedValue(
      Err({
        type: 'command-failed',
        error: { code: 'not-found', message: 'No route matches', recoverable: false },
      }),
    );
    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    // Even though the dashboard exists live, apply-dashboard requires the per-sheet route — it does not
    // silently re-post the whole workbook instead.
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
      expect(result.error.error.type).toBe('route-missing');
      invariant(result.error.error.type === 'route-missing');
      expect(result.error.error.message).not.toContain('create the dashboard');
      expect(result.error.error.message).toContain('No changes were sent');
    }
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('accepts a dashboard id and retitles a stale fragment before per-dashboard apply', async () => {
    const dashboardId = '{5804EDA1-BF3C-4000-96FF-E266A3A0FA44}';
    const fragment = `<dashboard name='Old Dashboard'><zones /><simple-id uuid='${dashboardId}' /></dashboard>`;
    const applyDashboardDocument = vi
      .fn()
      .mockResolvedValue(
        Ok({ command_id: 'cmd-apply', status: 'completed' as const, submitted_at: '' }),
      );
    const executor = makeExecutorMock({
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [{ id: dashboardId, name: 'Renamed Dashboard', hidden: false }],
        }),
      ),
      getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: fragment })),
      applyDashboardDocument,
    });

    const result = await loadDashboardXml({
      dashboardName: dashboardId,
      xml: fragment,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isOk()).toBe(true);
    expect(applyDashboardDocument).toHaveBeenCalledWith(
      dashboardId,
      expect.stringContaining("name='Renamed Dashboard'"),
      mockSignal,
    );
  });

  it('should return invalid-xml error when xml is empty', async () => {
    const mockExecutor = makeExecutorMock({ executeCommand: vi.fn() });

    const result = await loadDashboardXml({
      dashboardName,
      xml: '   ',
      executor: mockExecutor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-dashboard-xml-error');
      if (result.error.type === 'load-dashboard-xml-error') {
        expect(result.error.error.type).toBe('invalid-xml');
      }
    }
    expect(mockExecutor.executeCommand).not.toHaveBeenCalled();
  });

  it('should return validation-failed error when XML is not well-formed', async () => {
    const mockExecutor = makeExecutorMock({ executeCommand: vi.fn() });

    const result = await loadDashboardXml({
      dashboardName,
      xml: '<dashboard><unclosed>',
      executor: mockExecutor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-dashboard-xml-error');
      if (result.error.type === 'load-dashboard-xml-error') {
        expect(result.error.error.type).toBe('validation-failed');
      }
    }
    expect(mockExecutor.executeCommand).not.toHaveBeenCalled();
  });

  it('should return error when the workbook fetch fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    const mockExecutor = makeExecutorMock({
      // A failed snapshot read must stop before resolving or applying the target.
      listDashboards: vi.fn().mockResolvedValue(
        Err({
          type: 'command-failed',
          error: {
            code: 'not-found',
            message: 'No route matches GET /v0/workbook/dashboards',
            recoverable: false,
          },
        }),
      ),
      getWorkbookDocument: vi.fn().mockResolvedValue(Err(error)),
    });

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('execute-command-error');
      if (result.error.type === 'execute-command-error') {
        expect(result.error.error).toEqual(error);
      }
    }
  });

  it('should pass the abort signal to the dashboard apply', async () => {
    const customSignal = new AbortController().signal;
    const { executor } = dispatchingExecutor(liveWorkbook(['Sales Dashboard']));

    await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: customSignal,
      focus: NO_FOCUS,
    });

    expect(executor.applyDashboardDocument).toHaveBeenCalledWith(
      dashboardName,
      expect.any(String),
      customSignal,
    );
  });
});

describe('loadDashboardXml entity-like names', () => {
  beforeEach(() => {
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
  });

  it('rejects a dashboard named literally `A &amp; B` when the caller names `A & B`', async () => {
    const executor = makeExecutorMock({});

    const result = await loadDashboardXml({
      dashboardName: 'A & B',
      xml: "<dashboard name='A &amp;amp; B'><zones/></dashboard>",
      worksheetNames: [],
      focus: { navigate: 'none', reason: 'intermediate-leg' },
      executor,
      signal: new AbortController().signal,
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toMatchObject({
      type: 'load-dashboard-xml-error',
      error: { type: 'name-mismatch' },
    });
  });
});
