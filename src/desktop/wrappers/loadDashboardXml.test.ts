import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import invariant from '../../utils/invariant.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { ParsedWindow } from '../metadata/types.js';
import * as validationRegistry from '../validation/registry.js';
import { loadDashboardXml } from './loadDashboardXml.js';

// Focus is a required argument at every write seam. Suites that are not about
// navigation pass the disposition that dispatches nothing.
const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;
describe('loadDashboardXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const dashboardName = 'Sales Dashboard';
  const validXml = `<dashboard name='${dashboardName}'><zones></zones></dashboard>`;

  function liveWorkbook(dashboardNames: string[], worksheetNames: string[] = ['Sheet 1']): string {
    const worksheets = worksheetNames
      .map((name) => `<worksheet name='${name}'><table /></worksheet>`)
      .join('');
    const dashboards = dashboardNames
      .map((name) => `<dashboard name='${name}'><zones /></dashboard>`)
      .join('');
    const windows = dashboardNames
      .map((name) => `<window class='dashboard' name='${name}' />`)
      .join('');
    return `<?xml version='1.0'?><workbook><worksheets>${worksheets}</worksheets><dashboards>${dashboards}</dashboards><windows>${windows}</windows></workbook>`;
  }

  // A goto-sheet moves the live document, so the readback the verify pass reads must
  // reflect it — otherwise the double reports a navigation that never landed.
  function withMaximizedWindow(workbookXml: string, sheetName: string): string {
    return workbookXml
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
      return Ok({ command_id: 'cmd-apply', status: 'completed' as const, submitted_at: '' });
    });
    return {
      executor: makeExecutorMock({
        executeCommand,
        getWorkbookDocument,
        applyWorkbookDocument,
        // This double implements the whole-workbook transport (getWorkbookDocument +
        // applyWorkbookDocument) that flag-off callers (dashboard build/auto-apply,
        // apply-dashboard-with-viewpoints) use directly — they never attempt the per-sheet route. Its
        // list route returns `not-found` so the flag-on route-missing tests below (apply-dashboard /
        // apply-storyboard, which DO attempt the per-sheet route) see `route-missing`. The per-sheet
        // 'applied' path is covered in perSheetDocumentApply.test.ts.
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

  it('upserts the dashboard into the whole live workbook, preserving siblings and worksheets', async () => {
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
    expect(applied).toContain('name="Sales Dashboard"');
    // The POST replaces the open workbook wholesale, so the sibling dashboard and the live
    // worksheet MUST survive in the posted doc — omitting them would prune them from Desktop.
    expect(applied).toContain('name="Other DB"');
    expect(applied).toContain('name="Sheet 1"');
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
    const appliedXml = calls.find((call) => call.kind === 'apply')?.xml;
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

  it('keeps live worksheets referenced by the dashboard zones in the posted document', async () => {
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
    expect(applyCall?.xml).toContain('<worksheet');
    expect(applyCall?.xml).toContain('name="Sheet 1"');
  });

  it('appends a brand-new dashboard while preserving the existing one', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other DB']));

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
    expect(applyCall?.xml).toContain('name="Sales Dashboard"');
    expect(applyCall?.xml).toContain('name="Some Other DB"');
  });

  // An executor whose per-sheet list route works but does NOT contain the target dashboard, so a
  // flag-on apply-dashboard's tryApplyViaPerSheetRoute resolves `sheet-absent`. It still implements the
  // whole-workbook transport that flag-off callers use directly (they never attempt the per-sheet
  // route, so the list route stays untouched for them).
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

  it('names storyboardName (not dashboard_name) when the caller name disagrees with the XML', async () => {
    const executor = makeExecutorMock({});

    const result = await loadDashboardXml({
      dashboardName: 'Wrong Name',
      xml: "<dashboard name='QBR Story' type='storyboard'><zones /></dashboard>",
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      kind: 'storyboard',
      requireExistingSheet: true,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
      invariant(result.error.error.type === 'name-mismatch');
      expect(result.error.error.message).toContain('storyboardName');
      expect(result.error.error.message).not.toContain('dashboard_name');
    }
  });

  it('goes straight to the whole-workbook apply for an absent dashboard when requireExistingSheet is off', async () => {
    const { executor, calls } = absentDashboardExecutor(['Some Other DB']);

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    const applyCall = calls.find((c) => c.kind === 'apply');
    expect(applyCall?.xml).toContain('name="Sales Dashboard"');
    expect(applyCall?.xml).toContain('name="Some Other DB"');
  });

  // apply-dashboard/apply-storyboard are pure per-sheet applies: any non-`applied` outcome errors and
  // never falls back to the whole-workbook re-post. When the per-sheet route is unavailable
  // (dispatchingExecutor's list route returns `not-found` → route-missing) it must NOT quietly
  // whole-workbook apply — even for an existing sheet.
  it('errors and never whole-workbook applies when requireExistingSheet is set and the route is missing (absent name)', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other DB']));

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
    }
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('errors and never whole-workbook applies when requireExistingSheet is set and the route is missing (existing dashboard)', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sales Dashboard', 'Other DB']));

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
      expect(result.error.error.type).toBe('sheet-absent');
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
      // Route-missing list defers to the whole-workbook path, where the fetch below fails.
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

  it('should pass the abort signal to the workbook apply', async () => {
    const customSignal = new AbortController().signal;
    const { executor } = dispatchingExecutor(liveWorkbook(['Sales Dashboard']));

    await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: customSignal,
      focus: NO_FOCUS,
    });

    expect(executor.applyWorkbookDocument).toHaveBeenCalledWith(
      expect.any(String),
      customSignal,
      undefined,
    );
  });
});
