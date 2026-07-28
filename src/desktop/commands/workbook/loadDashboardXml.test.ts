import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../../logging/logger.js';
import { normalizeArray, parseXML } from '../../metadata/parser.js';
import type { ParsedWindow } from '../../metadata/types.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
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
    executor: ToolExecutor;
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
      return Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' });
    });
    let liveXml = workbookXml;
    const getWorkbookDocument = vi
      .fn()
      .mockImplementation(async () =>
        Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      calls.push({ kind: 'apply', xml });
      return Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' });
    });
    return {
      executor: {
        executeCommand,
        getWorkbookDocument,
        applyWorkbookDocument,
        listDashboards: vi
          .fn()
          .mockResolvedValue(Ok({ dashboards: [{ id: 'dashboard-1', name: dashboardName }] })),
      } as unknown as ToolExecutor,
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

  it('should return invalid-xml error when xml is empty', async () => {
    const mockExecutor = { executeCommand: vi.fn() } as unknown as ToolExecutor;

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
    const mockExecutor = { executeCommand: vi.fn() } as unknown as ToolExecutor;

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
    const mockExecutor = {
      getWorkbookDocument: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as ToolExecutor;

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

    expect(executor.applyWorkbookDocument).toHaveBeenCalledWith(expect.any(String), customSignal);
  });
});
