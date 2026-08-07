import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import invariant from '../../utils/invariant.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import { captureTargetWorksheetState } from '../metadata/targetWorksheetState.js';
import type { ParsedWindow } from '../metadata/types.js';
import * as validationRegistry from '../validation/registry.js';
import { loadWorksheetXml, verifyPostApplyWorksheetReadback } from './loadWorksheetXml.js';

// Focus is a required argument at every write seam. Suites that are not about
// navigation pass the disposition that dispatches nothing.
const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;
const sheetUpsertMock = vi.hoisted(() => ({
  upsertSheetIntoWorkbook: undefined as
    | undefined
    | ((workbookXml: string, sheetName: string, editedWorksheetXml: string) => string),
}));

vi.mock('../metadata/sheets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../metadata/sheets.js')>();
  return {
    ...actual,
    upsertSheetIntoWorkbook: (
      workbookXml: string,
      sheetName: string,
      editedWorksheetXml: string,
    ) =>
      sheetUpsertMock.upsertSheetIntoWorkbook
        ? sheetUpsertMock.upsertSheetIntoWorkbook(workbookXml, sheetName, editedWorksheetXml)
        : actual.upsertSheetIntoWorkbook(workbookXml, sheetName, editedWorksheetXml),
  };
});

describe('loadWorksheetXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';
  const validXml = `<worksheet name='${worksheetName}'><table><rows /></table></worksheet>`;

  function liveWorkbook(worksheetNames: string[], dashboardNames: string[] = []): string {
    const worksheets = worksheetNames
      .map((name) => `<worksheet name='${name}'><table /></worksheet>`)
      .join('');
    const dashboards = dashboardNames
      .map((name) => `<dashboard name='${name}'><zones /></dashboard>`)
      .join('');
    const windows = worksheetNames
      .map((name) => `<window class='worksheet' name='${name}' />`)
      .join('');
    const dashboardsBlock = dashboards ? `<dashboards>${dashboards}</dashboards>` : '';
    return `<?xml version='1.0'?><workbook><worksheets>${worksheets}</worksheets>${dashboardsBlock}<windows>${windows}</windows></workbook>`;
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
        // applyWorkbookDocument) that flag-off callers (build-and-apply-worksheet, refine-worksheet)
        // use directly — they never attempt the per-sheet route. Its list route returns `not-found`
        // so the flag-on route-missing tests below (apply-worksheet, which DOES attempt the per-sheet
        // route) see `route-missing`. The per-sheet 'applied' path is covered in
        // perSheetDocumentApply.test.ts.
        listWorksheets: vi.fn().mockResolvedValue(
          Err({
            type: 'command-failed',
            error: {
              code: 'not-found',
              message: 'No route matches GET /v0/workbook/worksheets',
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
    sheetUpsertMock.upsertSheetIntoWorkbook = undefined;
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('upserts the edited sheet into the whole live workbook, preserving siblings and dashboards', async () => {
    const { executor, calls } = dispatchingExecutor(
      liveWorkbook(['Sheet 1', 'Other'], ['Dashboard 1']),
    );

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();

    const applyCall = calls.find((c) => c.kind === 'apply');
    expect(typeof applyCall?.xml).toBe('string');
    expect(applyCall?.xml).toContain('name="Sheet 1"');
    // The POST replaces the open workbook wholesale, so the sibling sheet and the live dashboard
    // MUST survive in the posted doc — omitting them would prune them from Desktop.
    expect(applyCall?.xml).toContain('name="Other"');
    expect(applyCall?.xml).toContain('name="Dashboard 1"');
  });

  it('preserves the live active window and does not navigate after apply', async () => {
    const workbookXml = `<?xml version='1.0'?><workbook>
      <worksheets>
        <worksheet name='Sheet 1'><table /></worksheet>
        <worksheet name='Sheet 2'><table /></worksheet>
      </worksheets>
      <windows>
        <window class='worksheet' name='Sheet 1' />
        <window class='worksheet' name='Sheet 2' active='true' maximized='true' />
      </windows>
    </workbook>`;
    const { executor, calls } = dispatchingExecutor(workbookXml);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    const appliedXml = calls.find((call) => call.kind === 'apply')?.xml;
    expect(appliedXml).toBeDefined();
    const windows = normalizeArray<ParsedWindow>(parseXML(appliedXml!).workbook?.windows?.window);
    expect(windows.map((window) => window['@_name'])).toEqual(['Sheet 1', 'Sheet 2']);
    expect(windows[0]).not.toHaveProperty('@_active');
    expect(windows[0]).not.toHaveProperty('@_maximized');
    expect(windows[1]).toMatchObject({ '@_active': 'true', '@_maximized': 'true' });
    expect(calls.some((call) => call.command === 'goto-sheet')).toBe(false);
  });

  it('navigates to the worksheet it just applied when the caller names it as the artifact', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sheet 1', 'Sheet 2']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      focus: { navigate: 'artifact', sheetName: worksheetName },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(
      calls.filter((call) => call.command === 'goto-sheet').map((call) => call.args?.Sheet),
    ).toEqual([worksheetName]);
  });

  it('navigates with the semantic canonical worksheet name parsed from XML', async () => {
    const canonicalName = 'Sales & Profit';
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sales &amp; Profit', 'Other']));

    const result = await loadWorksheetXml({
      worksheetName: canonicalName,
      xml: '<worksheet name="Sales &amp; Profit"><table><rows /></table></worksheet>',
      focus: { navigate: 'artifact', sheetName: canonicalName },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    const gotoTargets = calls
      .filter((call) => call.command === 'goto-sheet')
      .map((call) => call.args?.Sheet);
    expect(gotoTargets.length).toBeGreaterThan(0);
    expect(gotoTargets.every((target) => target === canonicalName)).toBe(true);
  });

  it('appends a brand-new sheet while preserving the existing one', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other Sheet']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();
    const applyCall = calls.find((c) => c.kind === 'apply');
    expect(applyCall).toBeDefined();
    expect(applyCall?.xml).toContain('class="worksheet" name="Sheet 1"');
    expect(applyCall?.xml).toContain('name="Some Other Sheet"');
  });

  it('continues worksheet apply when both preflight stages contain only telemetry findings', async () => {
    const telemetryIssue = {
      ruleId: 'calc-field-names',
      severity: 'warning' as const,
      message:
        'Non-standard internal name detected (telemetry only): [Parameter 1]. If this field works correctly in Tableau, this warning can be ignored.',
    };
    vi.mocked(validationRegistry.runValidation).mockReturnValue({
      valid: false,
      issues: [telemetryIssue],
    });
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sheet 1']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.filter((call) => call.kind === 'apply')).toHaveLength(1);
    if (result.isOk()) {
      expect(result.value.validationWarnings).toEqual([telemetryIssue]);
    }
  });

  it('rejects a constructed workbook document missing the worksheet window before POST', async () => {
    vi.mocked(validationRegistry.runValidation).mockRestore();
    sheetUpsertMock.upsertSheetIntoWorkbook = () => `<?xml version='1.0'?>
<workbook>
  <worksheets>
    <worksheet name='Sheet 1'><table /></worksheet>
  </worksheets>
  <windows>
    <window><cards /></window>
  </windows>
</workbook>`;
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other Sheet']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'worksheet-missing-window',
            severity: 'error',
            message: expect.stringContaining('Sheet 1'),
          }),
        ]),
      );
    }
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('should return error when XML is invalid', async () => {
    const result = await loadWorksheetXml({
      worksheetName,
      xml: 'not xml',
      executor: makeExecutorMock(),
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('invalid-xml');
    }
  });

  it('should return error when XML is empty', async () => {
    const result = await loadWorksheetXml({
      worksheetName,
      xml: '',
      executor: makeExecutorMock(),
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-worksheet-xml-error');
    }
  });

  it('should return error when validation fails', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [{ ruleId: 'test-rule', severity: 'error', message: 'Invalid structure' }],
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: makeExecutorMock(),
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  // An executor whose per-sheet list route works but does NOT contain the target worksheet, so a
  // flag-on apply-worksheet's tryApplyViaPerSheetRoute resolves `sheet-absent`. It still implements the
  // whole-workbook transport that flag-off callers use directly (they never attempt the per-sheet
  // route, so the list route stays untouched for them).
  function absentSheetExecutor(liveWorksheetNames: string[]): {
    executor: ExternalApiToolExecutor;
    calls: Array<{ kind: 'command' | 'apply'; xml?: string }>;
  } {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(liveWorksheetNames));
    (executor as unknown as { listWorksheets: unknown }).listWorksheets = vi.fn().mockResolvedValue(
      Ok({
        worksheets: liveWorksheetNames.map((name, i) => ({ id: `id-${i}`, name, hidden: false })),
      }),
    );
    return { executor, calls };
  }

  it('surfaces sheet-absent (no whole-workbook fallback) when requireExistingSheet is set', async () => {
    const { executor, calls } = absentSheetExecutor(['Some Other Sheet']);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('sheet-absent');
    }
    // The whole-workbook apply must NOT have run — apply-worksheet does not create a sheet.
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('goes straight to the whole-workbook apply for an absent sheet when requireExistingSheet is off', async () => {
    const { executor, calls } = absentSheetExecutor(['Some Other Sheet']);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    // The flag-off caller never attempts the per-sheet route, so the net-new sheet is appended via the
    // whole-workbook apply.
    const applyCall = calls.find((c) => c.kind === 'apply');
    expect(applyCall?.xml).toContain('name="Sheet 1"');
    expect(applyCall?.xml).toContain('name="Some Other Sheet"');
  });

  // apply-worksheet is a pure per-sheet apply: any non-`applied` outcome errors and never falls back to
  // the whole-workbook re-post. When the per-sheet route is unavailable (dispatchingExecutor's list
  // route returns `not-found` → route-missing) it must NOT quietly whole-workbook apply — even for an
  // existing sheet.
  it('errors and never whole-workbook applies when requireExistingSheet is set and the route is missing (absent name)', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other Sheet']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('sheet-absent');
    }
    // The whole-workbook apply must NOT have run — apply-worksheet does not create a sheet.
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('errors and never whole-workbook applies when requireExistingSheet is set and the route is missing (existing sheet)', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sheet 1', 'Other']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    // Even though the sheet exists live, apply-worksheet requires the per-sheet route — it does not
    // silently re-post the whole workbook instead.
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('sheet-absent');
    }
    expect(calls.find((c) => c.kind === 'apply')).toBeUndefined();
  });

  it('should return execute-command-error when the workbook fetch fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    const mockExecutor = makeExecutorMock({
      // Route-missing list defers to the whole-workbook path, where the fetch below fails.
      listWorksheets: vi.fn().mockResolvedValue(
        Err({
          type: 'command-failed',
          error: {
            code: 'not-found',
            message: 'No route matches GET /v0/workbook/worksheets',
            recoverable: false,
          },
        }),
      ),
      getWorkbookDocument: vi.fn().mockResolvedValue(Err(error)),
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });

  it('applies an artifact against the latest workbook and preserves unrelated live edits', async () => {
    const baseline = liveWorkbook(['Sheet 1', 'Other'], ['Dashboard 1']);
    const latest = baseline.replace(
      "<worksheet name='Other'><table /></worksheet>",
      "<worksheet name='Other'><table><rows>[live].[edit]</rows></table></worksheet>",
    );
    const artifactWindow =
      "<window class='worksheet' name='Sheet 1'><cards><edge name='left'/></cards></window>";
    const dispatchState = { attempted: false };
    let liveXml = latest;
    const applyWorkbookDocument = vi.fn(
      async (
        xml: string,
        _signal: AbortSignal,
        options?: { expectedInstanceId?: string; onDispatch?: () => void },
      ) => {
        expect(dispatchState.attempted).toBe(false);
        expect(options?.expectedInstanceId).toBe('inst-build');
        options?.onDispatch?.();
        liveXml = xml;
        return Ok({ command_id: 'apply-artifact', status: 'completed' as const, submitted_at: '' });
      },
    );
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      applyWorkbookDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      artifactApply: {
        windowXml: artifactWindow,
        expectedTargetState: captureTargetWorksheetState(baseline, worksheetName, validXml),
        expectedInstanceId: 'inst-build',
        dispatchState,
      },
    });

    expect(result.isOk()).toBe(true);
    expect(dispatchState.attempted).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    const posted = applyWorkbookDocument.mock.calls[0][0];
    expect(posted).toContain('[live].[edit]');
    expect(posted).toContain('name="Dashboard 1"');
    expect(posted).toContain('name="left"');
    if (result.isOk()) expect(result.value.readbackVerification?.status).toBe('passed');
  });

  it('does not let an unchanged pre-existing workbook error veto an artifact apply', async () => {
    vi.mocked(validationRegistry.runValidation).mockRestore();
    const baseline = liveWorkbook(['Sheet 1', 'Existing']).replace(
      "<window class='worksheet' name='Existing' />",
      '',
    );
    const dispatchState = { attempted: false };
    let liveXml = baseline;
    const applyWorkbookDocument = vi.fn(
      async (
        xml: string,
        _signal: AbortSignal,
        options?: { expectedInstanceId?: string; onDispatch?: () => void },
      ) => {
        options?.onDispatch?.();
        liveXml = xml;
        return Ok({
          command_id: 'apply-artifact',
          status: 'completed' as const,
          submitted_at: '',
        });
      },
    );
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      applyWorkbookDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      artifactApply: {
        windowXml: `<window class='worksheet' name='${worksheetName}' />`,
        expectedTargetState: captureTargetWorksheetState(baseline, worksheetName, validXml),
        expectedInstanceId: 'inst-build',
        dispatchState,
      },
    });

    expect(result.isOk()).toBe(true);
    expect(dispatchState.attempted).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('still rejects a workbook-only error introduced by artifact assembly', async () => {
    vi.mocked(validationRegistry.runValidation).mockRestore();
    const baseline = liveWorkbook(['Sheet 1']);
    const xmlWithMissingSet = `<worksheet name='${worksheetName}'><table>
      <datasource-dependencies datasource='DS'>
        <column name='[Calculation_1]'>
          <calculation class='tableau' formula='IF [Missing Set] THEN &quot;yes&quot; ELSE &quot;no&quot; END'/>
        </column>
      </datasource-dependencies>
    </table></worksheet>`;
    const dispatchState = { attempted: false };
    const applyWorkbookDocument = vi.fn();
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: baseline, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      applyWorkbookDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: xmlWithMissingSet,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      artifactApply: {
        windowXml: `<window class='worksheet' name='${worksheetName}' />`,
        expectedTargetState: captureTargetWorksheetState(
          baseline,
          worksheetName,
          xmlWithMissingSet,
        ),
        expectedInstanceId: 'inst-build',
        dispatchState,
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleId: 'undeclared-set-reference', severity: 'error' }),
        ]),
      );
    }
    expect(dispatchState.attempted).toBe(false);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a new copy of a workbook error already present on a sibling sheet', async () => {
    vi.mocked(validationRegistry.runValidation).mockRestore();
    const missingSetCalculation =
      "<column name='[Calculation_1]'><calculation class='tableau' formula='IF [Missing Set] THEN &quot;yes&quot; ELSE &quot;no&quot; END'/></column>";
    const baseline = liveWorkbook(['Sheet 1', 'Existing']).replace(
      "<worksheet name='Existing'><table /></worksheet>",
      `<worksheet name='Existing'><table><datasource-dependencies datasource='DS'>${missingSetCalculation}</datasource-dependencies></table></worksheet>`,
    );
    const targetXml = `<worksheet name='${worksheetName}'><table><datasource-dependencies datasource='DS'>${missingSetCalculation}</datasource-dependencies></table></worksheet>`;
    const dispatchState = { attempted: false };
    const applyWorkbookDocument = vi.fn(async () =>
      Ok({ command_id: 'unexpected-apply', status: 'completed' as const, submitted_at: '' }),
    );
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: baseline, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      applyWorkbookDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: targetXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      artifactApply: {
        windowXml: `<window class='worksheet' name='${worksheetName}' />`,
        expectedTargetState: captureTargetWorksheetState(baseline, worksheetName, targetXml),
        expectedInstanceId: 'inst-build',
        dispatchState,
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleId: 'undeclared-set-reference', severity: 'error' }),
        ]),
      );
    }
    expect(dispatchState.attempted).toBe(false);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects scoped target drift before dispatch', async () => {
    const baseline = liveWorkbook(['Sheet 1', 'Other']);
    const latest = baseline.replace(
      "<worksheet name='Sheet 1'><table /></worksheet>",
      "<worksheet name='Sheet 1'><table><rows>[changed]</rows></table></worksheet>",
    );
    const dispatchState = { attempted: false };
    const applyWorkbookDocument = vi.fn();
    const executor = makeExecutorMock({
      getWorkbookDocument: vi
        .fn()
        .mockResolvedValue(
          Ok({ xml: latest, applicationVersion: undefined, xsdPayloadVersion: undefined }),
        ),
      applyWorkbookDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      artifactApply: {
        windowXml: `<window class='worksheet' name='${worksheetName}' />`,
        expectedTargetState: captureTargetWorksheetState(baseline, worksheetName, validXml),
        expectedInstanceId: 'inst-build',
        dispatchState,
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('artifact-drift');
    }
    expect(dispatchState.attempted).toBe(false);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('reports post-dispatch artifact verification failure without making the apply retryable', async () => {
    vi.useFakeTimers();
    try {
      const baseline = liveWorkbook(['Sheet 1']);
      const intendedXml =
        "<worksheet name='Sheet 1'><table><rows>[DS].[sum:Profit:qk]</rows></table></worksheet>";
      const dispatchState = { attempted: false };
      const executor = makeExecutorMock({
        getWorkbookDocument: vi
          .fn()
          .mockResolvedValue(
            Ok({ xml: baseline, applicationVersion: undefined, xsdPayloadVersion: undefined }),
          ),
        applyWorkbookDocument: vi.fn(
          async (_xml: string, _signal: AbortSignal, options?: { onDispatch?: () => void }) => {
            options?.onDispatch?.();
            return Ok({
              command_id: 'apply-artifact',
              status: 'completed' as const,
              submitted_at: '',
            });
          },
        ),
      });

      const pending = loadWorksheetXml({
        worksheetName,
        xml: intendedXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
        artifactApply: {
          windowXml: `<window class='worksheet' name='${worksheetName}' />`,
          expectedTargetState: captureTargetWorksheetState(baseline, worksheetName, intendedXml),
          expectedInstanceId: 'inst-build',
          dispatchState,
        },
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(dispatchState.attempted).toBe(true);
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.readbackVerification).toMatchObject({ ok: false, status: 'failed' });
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('verifyPostApplyWorksheetReadback (async-settle poll)', () => {
  const signal = new AbortController().signal;
  const GEO = '[DS].[none:State:nk]';
  const PROFIT = '[DS].[sum:Profit:qk]';

  const worksheet = (withLod: boolean): string =>
    '<worksheet name="Blank Map"><table>' +
    '<panes><pane><mark class="Shape"/><encodings>' +
    (withLod ? `<lod column="${GEO}"/>` : '') +
    `<color column="${PROFIT}"/>` +
    '</encodings></pane></panes>' +
    `<rows>${GEO}</rows><cols>${PROFIT}</cols>` +
    '</table></worksheet>';

  const workbookDoc = (withLod: boolean): { xml: string } => ({
    xml: `<workbook><worksheets>${worksheet(withLod)}</worksheets></workbook>`,
  });

  const listOk = (): ReturnType<typeof Ok> =>
    Ok({ worksheets: [{ id: 'sheet-1', name: 'Blank Map' }] });

  it('retries past a racing pre-apply read and passes once the apply settles', async () => {
    const getWorksheetDocument = vi
      .fn()
      .mockResolvedValueOnce(Ok(workbookDoc(false)))
      .mockResolvedValueOnce(Ok(workbookDoc(false)))
      .mockResolvedValue(Ok(workbookDoc(true)));
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(listOk()),
      getWorksheetDocument,
    });

    const verification = await verifyPostApplyWorksheetReadback(
      'Blank Map',
      worksheet(true),
      executor,
      signal,
    );

    expect(verification.status).toBe('passed');
    expect(getWorksheetDocument.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('reports a durable drop as failed after exhausting the poll budget', async () => {
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(listOk()),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok(workbookDoc(false))),
    });

    const verification = await verifyPostApplyWorksheetReadback(
      'Blank Map',
      worksheet(true),
      executor,
      signal,
    );

    expect(verification.status).toBe('failed');
    expect(verification.findings.some((f) => f.severity === 'error')).toBe(true);
  });
});
