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

  function inlineDiagnosticsDocumentWarningScenario(route: 'artifact' | 'per-sheet' | 'upsert'): {
    applyWorkbookDocument: ReturnType<typeof vi.fn>;
    applyWorksheetDocument: ReturnType<typeof vi.fn>;
    documentWarning: string;
    expectedWorksheetId: string;
    getWorkbookDocument: ReturnType<typeof vi.fn>;
    getWorksheetDiagnostics: ReturnType<typeof vi.fn>;
    getWorksheetDocument: ReturnType<typeof vi.fn>;
    nativeFieldName: string;
    readbackVerificationOut: NonNullable<
      Parameters<typeof loadWorksheetXml>[0]['readbackVerificationOut']
    >;
    run: () => ReturnType<typeof loadWorksheetXml>;
  } {
    const liveWorksheetId = 'live-sheet-id';
    const xmlWorksheetId = 'xml-sheet-id';
    const expectedWorksheetId = route === 'per-sheet' ? liveWorksheetId : xmlWorksheetId;
    const decoyWorksheetId = route === 'per-sheet' ? xmlWorksheetId : liveWorksheetId;
    const nativeFieldName = `[none:${route} Missing:nk]`;
    const documentWarning = `Dropped ${route} filter.`;
    const xml =
      route === 'per-sheet'
        ? validXml
        : `<worksheet name='${worksheetName}'><simple-id uuid='${xmlWorksheetId}'/><table><rows /></table></worksheet>`;
    const baseline = liveWorkbook([worksheetName]);
    const diagnostics = {
      worksheets: [
        {
          worksheetId: expectedWorksheetId,
          status: 'complete' as const,
          invalidFields: [
            {
              fieldName: nativeFieldName,
              fieldCaption: `${route} Missing`,
              shelf: 'filter-shelf',
              marksSpecificationId: 'marks-1',
              encodingType: 'filter',
              reason: 'Field is unavailable.',
            },
          ],
        },
        {
          worksheetId: decoyWorksheetId,
          status: 'complete' as const,
          invalidFields: [
            {
              fieldName: '[none:Wrong Target:nk]',
              fieldCaption: 'Wrong Target',
              shelf: 'rows-shelf',
              marksSpecificationId: 'marks-decoy',
              encodingType: 'text',
              reason: 'This finding belongs to another worksheet.',
            },
          ],
        },
      ],
    };
    const applyResponse = Ok({
      command_id: `apply-${route}`,
      status: 'completed' as const,
      submitted_at: '',
      warnings: [{ code: 'document-warning', message: documentWarning }],
      diagnostics,
    });
    const applyWorksheetDocument = vi.fn().mockResolvedValue(applyResponse);
    const applyWorkbookDocument = vi.fn().mockResolvedValue(applyResponse);
    const getWorksheetDocument = vi.fn().mockResolvedValue(Ok({ xml }));
    const getWorkbookDocument = vi
      .fn()
      .mockResolvedValue(
        Ok({ xml: baseline, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      );
    const getWorksheetDiagnostics = vi.fn();
    const executor = makeExecutorMock({
      desktopInstanceId: route === 'artifact' ? 'inst-build' : 'inst-test',
      desktopApiVersion: '0.2.16',
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: liveWorksheetId, name: worksheetName }] })),
      getWorksheetDocument,
      getWorkbookDocument,
      applyWorksheetDocument,
      applyWorkbookDocument,
      getWorksheetDiagnostics,
    });
    const readbackVerificationOut: NonNullable<
      Parameters<typeof loadWorksheetXml>[0]['readbackVerificationOut']
    > = [];
    const dispatchState = { attempted: false };

    return {
      applyWorkbookDocument,
      applyWorksheetDocument,
      documentWarning,
      expectedWorksheetId,
      getWorkbookDocument,
      getWorksheetDiagnostics,
      getWorksheetDocument,
      nativeFieldName,
      readbackVerificationOut,
      run: () =>
        loadWorksheetXml({
          worksheetName,
          xml,
          executor,
          signal: mockSignal,
          focus: NO_FOCUS,
          readbackVerificationOut,
          ...(route === 'per-sheet'
            ? { requireExistingSheet: true, callerPreflightsBlockingIssues: true }
            : {}),
          ...(route === 'artifact'
            ? {
                artifactApply: {
                  windowXml: `<window class='worksheet' name='${worksheetName}' />`,
                  expectedTargetState: captureTargetWorksheetState(baseline, worksheetName, xml),
                  expectedInstanceId: 'inst-build',
                  dispatchState,
                },
              }
            : {}),
        }),
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

  it('omits a pre-existing error from cached worksheet validation warnings', async () => {
    const existingIssue = {
      ruleId: 'existing',
      severity: 'error' as const,
      message: 'already broken',
    };
    vi.mocked(validationRegistry.runValidation).mockReturnValue({
      valid: false,
      issues: [existingIssue],
    });
    const getWorksheetDocument = vi.fn().mockResolvedValue(Ok({ xml: validXml }));
    const applyWorksheetDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
    const executor = makeExecutorMock({
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] })),
      getWorksheetDocument,
      applyWorksheetDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.validationWarnings).toEqual([]);
    expect(applyWorksheetDocument).toHaveBeenCalledOnce();
  });

  it('automatically surfaces invalid used fields after a successful cached worksheet apply', async () => {
    const worksheetId = 'sheet-1';
    const xml = `<worksheet name='${worksheetName}'><simple-id uuid='${worksheetId}'/><table><rows /></table></worksheet>`;
    const getWorksheetDocument = vi.fn().mockResolvedValue(Ok({ xml }));
    const applyWorksheetDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-apply', status: 'completed', submitted_at: '' }));
    const getWorksheetDiagnostics = vi.fn().mockResolvedValue(
      Ok({
        worksheets: [
          {
            worksheetId,
            status: 'complete',
            invalidFields: [
              {
                fieldName: '[none:Missing:nk]',
                shelf: 'rows',
                marksSpecificationId: 'marks-1',
                encodingType: 'text',
                reason: 'Field is unavailable.',
              },
            ],
          },
        ],
      }),
    );
    const executor = makeExecutorMock({
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: worksheetId, name: worksheetName }] })),
      getWorksheetDocument,
      applyWorksheetDocument,
      getWorksheetDiagnostics,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
      callerPreflightsBlockingIssues: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.readbackVerification).toMatchObject({
        ok: false,
        status: 'failed',
        findings: [
          expect.objectContaining({
            source: 'used-field-validity',
            fieldName: '[none:Missing:nk]',
          }),
        ],
      });
    }
    expect(applyWorksheetDocument).toHaveBeenCalledWith(
      worksheetId,
      expect.any(String),
      mockSignal,
      { expectedInstanceId: 'inst-test' },
    );
    expect(getWorksheetDiagnostics).toHaveBeenCalledWith(worksheetId, mockSignal, 'inst-test');
  });

  it('uses inline partial diagnostics for the applied worksheet without a redundant validation GET', async () => {
    const worksheetId = 'sheet-1';
    const xml = `<worksheet name='${worksheetName}'><simple-id uuid='${worksheetId}'/><table><rows /></table></worksheet>`;
    const getWorksheetDiagnostics = vi.fn();
    const applyWorksheetDocument = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-apply',
        status: 'completed',
        submitted_at: '',
        diagnostics: {
          worksheets: [
            {
              worksheetId,
              status: 'partial',
              invalidFields: [
                {
                  fieldName: '[none:Missing:nk]',
                  shelf: 'rows',
                  marksSpecificationId: 'marks-1',
                  encodingType: 'text',
                  reason: 'Field is unavailable.',
                },
              ],
              message: 'Some fields could not be checked.',
            },
          ],
        },
      }),
    );
    const executor = makeExecutorMock({
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: worksheetId, name: worksheetName }] })),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml })),
      applyWorksheetDocument,
      getWorksheetDiagnostics,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
      callerPreflightsBlockingIssues: true,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().readbackVerification).toMatchObject({
      ok: false,
      status: 'failed',
      findings: expect.arrayContaining([
        expect.objectContaining({
          source: 'used-field-validity',
          worksheetId,
          fieldName: '[none:Missing:nk]',
        }),
        expect.objectContaining({ reason: 'diagnostics-partial', severity: 'warning' }),
      ]),
    });
    expect(applyWorksheetDocument).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).not.toHaveBeenCalled();
  });

  it('uses the per-sheet apply ID for inline diagnostics even when structural readback reports another ID', async () => {
    const appliedWorksheetId = 'live-sheet-id';
    const readbackWorksheetId = 'readback-sheet-id';
    const readbackXml = `<worksheet name='${worksheetName}'><simple-id uuid='${readbackWorksheetId}'/><table><rows /></table></worksheet>`;
    const getWorksheetDiagnostics = vi.fn();
    const getWorksheetDocument = vi.fn().mockResolvedValue(Ok({ xml: readbackXml }));
    const applyWorksheetDocument = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-apply',
        status: 'completed',
        submitted_at: '',
        diagnostics: {
          worksheets: [
            {
              worksheetId: appliedWorksheetId,
              status: 'complete',
              invalidFields: [
                {
                  fieldName: '[none:Applied Target Missing:nk]',
                  fieldCaption: 'Applied Target Missing',
                  shelf: 'rows-shelf',
                  marksSpecificationId: 'marks-live',
                  encodingType: 'text',
                  reason: 'Field is unavailable.',
                },
              ],
            },
            {
              worksheetId: readbackWorksheetId,
              status: 'complete',
              invalidFields: [
                {
                  fieldName: '[none:Wrong Readback Target:nk]',
                  fieldCaption: 'Wrong Readback Target',
                  shelf: 'filter-shelf',
                  marksSpecificationId: 'marks-readback',
                  encodingType: 'filter',
                  reason: 'This finding belongs to another worksheet.',
                },
              ],
            },
          ],
        },
      }),
    );
    const executor = makeExecutorMock({
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: appliedWorksheetId, name: worksheetName }] })),
      getWorksheetDocument,
      applyWorksheetDocument,
      getWorksheetDiagnostics,
    });
    const readbackVerificationOut: NonNullable<
      Parameters<typeof loadWorksheetXml>[0]['readbackVerificationOut']
    > = [];

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
      callerPreflightsBlockingIssues: true,
      readbackVerificationOut,
    });

    expect(result.isOk()).toBe(true);
    const report = result.unwrap().readbackVerification;
    expect(report).toMatchObject({
      ok: false,
      status: 'failed',
      findings: expect.arrayContaining([
        expect.objectContaining({
          source: 'used-field-validity',
          worksheetId: appliedWorksheetId,
          fieldName: '[none:Applied Target Missing:nk]',
        }),
      ]),
    });
    expect(JSON.stringify(report)).not.toContain('[none:Wrong Readback Target:nk]');
    expect(readbackVerificationOut).toEqual([report]);
    expect(applyWorksheetDocument).toHaveBeenCalledOnce();
    expect(getWorksheetDocument).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).not.toHaveBeenCalled();
  });

  it('keeps malformed inline diagnostics out of dropped-document warnings without replaying the apply', async () => {
    const worksheetId = 'sheet-1';
    const xml = `<worksheet name='${worksheetName}'><simple-id uuid='${worksheetId}'/><table><rows /></table></worksheet>`;
    const getWorksheetDiagnostics = vi.fn();
    const applyWorksheetDocument = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-apply',
        status: 'completed',
        submitted_at: '',
        diagnosticsInvalid: true,
      }),
    );
    const executor = makeExecutorMock({
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: worksheetId, name: worksheetName }] })),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml })),
      applyWorksheetDocument,
      getWorksheetDiagnostics,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
      callerPreflightsBlockingIssues: true,
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().readbackVerification).toMatchObject({
      ok: true,
      status: 'skipped',
      findings: [expect.objectContaining({ reason: 'diagnostics-invalid' })],
    });
    expect(result.unwrap().readbackVerification?.message).not.toContain('dropped state');
    expect(applyWorksheetDocument).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).not.toHaveBeenCalled();
  });

  it('post-apply contract: combines a durable structural drop with native invalid fields after one per-sheet apply', async () => {
    vi.useFakeTimers();
    try {
      const worksheetId = 'sheet-1';
      const intendedXml = `<worksheet name='${worksheetName}'><simple-id uuid='${worksheetId}'/><table><panes><pane><mark class='Bar'/><encodings><color column='[DS].[sum:Sales:qk]'/></encodings></pane></panes><cols>[DS].[sum:Sales:qk]</cols></table></worksheet>`;
      const droppedXml = intendedXml.replace("<color column='[DS].[sum:Sales:qk]'/>", '');
      const applyWorksheetDocument = vi
        .fn()
        .mockResolvedValue(
          Ok({ command_id: 'cmd-apply', status: 'completed' as const, submitted_at: '' }),
        );
      const getWorksheetDiagnostics = vi.fn().mockResolvedValue(
        Ok({
          worksheets: [
            {
              worksheetId,
              status: 'complete',
              invalidFields: [
                {
                  fieldName: '[none:Missing:nk]',
                  shelf: 'rows',
                  marksSpecificationId: 'marks-1',
                  encodingType: 'text',
                  reason: 'Field is unavailable.',
                },
              ],
            },
          ],
        }),
      );
      const executor = makeExecutorMock({
        desktopInstanceId: 'inst-test',
        desktopApiVersion: '0.2.16',
        listWorksheets: vi
          .fn()
          .mockResolvedValue(Ok({ worksheets: [{ id: worksheetId, name: worksheetName }] })),
        getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: droppedXml })),
        applyWorksheetDocument,
        getWorksheetDiagnostics,
      });

      const pending = loadWorksheetXml({
        worksheetName,
        xml: intendedXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
        requireExistingSheet: true,
        callerPreflightsBlockingIssues: true,
      });
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.readbackVerification).toMatchObject({
          ok: false,
          status: 'failed',
          findings: expect.arrayContaining([
            expect.objectContaining({ source: 'readback', severity: 'error' }),
            expect.objectContaining({
              source: 'used-field-validity',
              fieldName: '[none:Missing:nk]',
            }),
          ]),
        });
      }
      expect(applyWorksheetDocument).toHaveBeenCalledOnce();
      expect(getWorksheetDiagnostics).toHaveBeenCalledOnce();
      expect(getWorksheetDiagnostics).toHaveBeenCalledWith(worksheetId, mockSignal, 'inst-test');
    } finally {
      vi.useRealTimers();
    }
  });

  it('post-apply contract: runs native validation when structural readback is skipped but the target is stable', async () => {
    const worksheetId = 'sheet-1';
    const xml = `<worksheet name='${worksheetName}'><simple-id uuid='${worksheetId}'/><table><rows /></table></worksheet>`;
    const applyWorksheetDocument = vi
      .fn()
      .mockResolvedValue(
        Ok({ command_id: 'cmd-apply', status: 'completed' as const, submitted_at: '' }),
      );
    const getWorksheetDiagnostics = vi
      .fn()
      .mockResolvedValue(
        Ok({ worksheets: [{ worksheetId, status: 'complete', invalidFields: [] }] }),
      );
    const executor = makeExecutorMock({
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: worksheetId, name: worksheetName }] })),
      getWorksheetDocument: vi.fn().mockResolvedValue(
        Err({
          type: 'command-failed',
          error: { code: 'READ_FAILED', message: 'readback unavailable', recoverable: true },
        }),
      ),
      applyWorksheetDocument,
      getWorksheetDiagnostics,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
      callerPreflightsBlockingIssues: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.readbackVerification).toMatchObject({
        ok: true,
        status: 'skipped',
      });
      expect(result.value.readbackVerification?.findings ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'structural-readback-unavailable' }),
        ]),
      );
    }
    expect(applyWorksheetDocument).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).toHaveBeenCalledWith(worksheetId, mockSignal, 'inst-test');
  });

  it('skips the introduced-issue GET when the caller already preflighted blocking issues', async () => {
    const getWorksheetDocument = vi.fn().mockResolvedValue(Ok({ xml: validXml }));
    const applyWorksheetDocument = vi.fn().mockResolvedValue(
      Err({
        type: 'command-failed',
        error: { code: 'FAILED', message: 'apply failed', recoverable: false },
      }),
    );
    const executor = makeExecutorMock({
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] })),
      getWorksheetDocument,
      applyWorksheetDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
      callerPreflightsBlockingIssues: true,
    });

    expect(result.isErr()).toBe(true);
    expect(getWorksheetDocument).not.toHaveBeenCalled();
    expect(applyWorksheetDocument).toHaveBeenCalledOnce();
  });

  it('keeps the introduced-issue GET for a hash-less cached worksheet apply', async () => {
    const liveXml = "<worksheet name='Sheet 1'><table><rows>[baseline]</rows></table></worksheet>";
    const getWorksheetDocument = vi.fn().mockResolvedValue(Ok({ xml: liveXml }));
    const applyWorksheetDocument = vi.fn().mockResolvedValue(
      Err({
        type: 'command-failed',
        error: { code: 'FAILED', message: 'apply failed', recoverable: false },
      }),
    );
    const executor = makeExecutorMock({
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] })),
      getWorksheetDocument,
      applyWorksheetDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isErr()).toBe(true);
    expect(getWorksheetDocument).toHaveBeenCalledOnce();
    expect(validationRegistry.runValidation).toHaveBeenNthCalledWith(2, liveXml, 'worksheet');
    expect(validationRegistry.runValidation).toHaveBeenNthCalledWith(3, validXml, 'worksheet');
    expect(applyWorksheetDocument).toHaveBeenCalledOnce();
  });

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

  it('returns an actionable error before populating a blank dashboard-member worksheet', async () => {
    const liveBlankXml = `<worksheet name='Sheet 1'><table>
      <view><datasources /><aggregation value='true' /></view>
      <style /><panes><pane><view><breakdown value='auto' /></view><mark class='Automatic' /></pane></panes>
      <rows /><cols />
    </table><simple-id uuid='sheet-1' /></worksheet>`;
    const populatedXml = `<worksheet name='Sheet 1'><table>
      <view><datasources><datasource name='Sample - Superstore' /></datasources>
        <datasource-dependencies datasource='Sample - Superstore' />
      </view>
      <rows>[Sample - Superstore].[none:Category:nk]</rows>
      <cols>[Sample - Superstore].[sum:Profit:qk]</cols>
    </table><simple-id uuid='sheet-1' /></worksheet>`;
    const applyWorksheetDocument = vi.fn();
    const executor = makeExecutorMock({
      listWorksheets: vi
        .fn()
        .mockResolvedValue(
          Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName, hidden: false }] }),
        ),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: liveBlankXml })),
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [
            {
              id: 'dashboard-1',
              name: 'Dashboard 1',
              hidden: false,
              containedSheets: ['sheet-1'],
            },
          ],
        }),
      ),
      applyWorksheetDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: populatedXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error).toEqual({
        type: 'dashboard-member-blank-transition',
        message:
          'Worksheet "Sheet 1" is blank and already used by dashboard "Dashboard 1". Desktop cannot safely populate it while it belongs to a dashboard. Remove it from the dashboard, build the chart, then add it back. No changes were sent to Tableau.',
      });
    }
    expect(applyWorksheetDocument).not.toHaveBeenCalled();
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

  it('targets the per-sheet route by the fragment simple-id, so an apply lands after a live rename', async () => {
    const sheetId = '{5804EDA1-BF3C-4000-96FF-E266A3A0FA44}';
    const fragment = `<worksheet name='${worksheetName}'><simple-id uuid='${sheetId}' /><table><rows /></table></worksheet>`;
    const applyWorksheetDocument = vi
      .fn()
      .mockResolvedValue(
        Ok({ command_id: 'cmd-apply', status: 'completed' as const, submitted_at: '' }),
      );
    const executor = makeExecutorMock({
      // The live sheet kept its id but was renamed after the fragment was read: only the id matches.
      listWorksheets: vi
        .fn()
        .mockResolvedValue(
          Ok({ worksheets: [{ id: sheetId, name: 'Renamed Live', hidden: false }] }),
        ),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: fragment })),
      applyWorksheetDocument,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: fragment,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.appliedName).toBe('Renamed Live');
    }
    // Had it targeted by the fragment name ('Sheet 1' ≠ the live 'Renamed Live'), the route would
    // have resolved to sheet-absent. Desktop also requires the posted fragment's root name to match
    // the current live name even when the route is addressed by id.
    expect(applyWorksheetDocument).toHaveBeenCalledWith(
      sheetId,
      expect.stringContaining("name='Renamed Live'"),
      mockSignal,
    );
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
    if (result.isOk()) {
      expect(result.value.readbackVerification).toMatchObject({
        status: 'skipped',
        findings: [expect.objectContaining({ reason: 'target-unresolved' })],
      });
    }
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

  it.each([
    {
      label: 'a dropped shelf',
      intendedXml:
        "<worksheet name='Sheet 1'><table><rows>[DS].[sum:Profit:qk]</rows></table></worksheet>",
      readback: liveWorkbook(['Sheet 1']),
      expectedFindings: expect.arrayContaining([
        expect.objectContaining({
          kind: 'shelf',
          node: 'rows',
          column: '[DS].[sum:Profit:qk]',
          readback: 'missing',
          severity: 'error',
        }),
      ]),
      expectedMessage: '[DS].[sum:Profit:qk]',
    },
    {
      label: 'a dropped wedge-size encoding',
      intendedXml:
        "<worksheet name='Sheet 1'><table><panes><pane><mark class='Pie'/><encodings>" +
        "<wedge-size column='[DS].[sum:Box Office Revenue:qk]'/></encodings></pane></panes>" +
        '</table></worksheet>',
      readback: liveWorkbook(['Sheet 1']),
      expectedFindings: expect.arrayContaining([
        expect.objectContaining({
          kind: 'encoding',
          node: 'wedge-size',
          column: '[DS].[sum:Box Office Revenue:qk]',
          readback: 'missing',
          severity: 'error',
        }),
      ]),
      expectedMessage: '<wedge-size column="[DS].[sum:Box Office Revenue:qk]">',
    },
    {
      label: 'the worksheet missing entirely',
      intendedXml: validXml,
      readback: liveWorkbook([]),
      expectedFindings: [],
      expectedMessage: 'was absent from the post-apply workbook readback',
    },
  ])(
    'reports post-dispatch artifact verification failure without making the apply retryable: $label',
    async ({ intendedXml, readback, expectedFindings, expectedMessage }) => {
      vi.useFakeTimers();
      try {
        const baseline = liveWorkbook(['Sheet 1']);
        const dispatchState = { attempted: false };
        const executor = makeExecutorMock({
          getWorkbookDocument: vi
            .fn()
            .mockResolvedValueOnce(
              Ok({ xml: baseline, applicationVersion: undefined, xsdPayloadVersion: undefined }),
            )
            .mockResolvedValue(
              Ok({ xml: readback, applicationVersion: undefined, xsdPayloadVersion: undefined }),
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
          expect(result.value.readbackWarnings).toEqual(expectedFindings);
          expect(result.value.readbackVerification).toMatchObject({
            ok: false,
            status: 'failed',
          });
          const verificationText = [
            result.value.readbackVerification?.message ?? '',
            ...result.value.readbackWarnings.map((finding) => finding.intended),
          ].join(' ');
          expect(verificationText).toContain(expectedMessage);
        }
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('post-apply contract: keeps a per-sheet document warning as failed verification after native validation', async () => {
    const worksheetId = 'sheet-1';
    const applyWorksheetDocument = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-apply',
        status: 'completed',
        submitted_at: '',
        warnings: [{ code: 'document-warning', message: 'Dropped filter on [Country/Region].' }],
      }),
    );
    const getWorksheetDiagnostics = vi
      .fn()
      .mockResolvedValue(
        Ok({ worksheets: [{ worksheetId, status: 'complete', invalidFields: [] }] }),
      );
    const executor = makeExecutorMock({
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: worksheetId, name: worksheetName }] })),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: validXml })),
      applyWorksheetDocument,
      getWorksheetDiagnostics,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      requireExistingSheet: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.readbackVerification).toMatchObject({ ok: false, status: 'failed' });
      expect(JSON.stringify(result.value.readbackVerification)).toContain(
        'Dropped filter on [Country/Region].',
      );
    }
    expect(applyWorksheetDocument).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).toHaveBeenCalledWith(worksheetId, mockSignal, 'inst-test');
  });

  it('post-apply contract: keeps a whole-workbook document warning as failed verification after native validation', async () => {
    const worksheetId = 'sheet-1';
    const xml = `<worksheet name='${worksheetName}'><simple-id uuid='${worksheetId}'/><table><rows /></table></worksheet>`;
    const applyWorkbookDocument = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-apply',
        status: 'completed',
        submitted_at: '',
        warnings: [{ code: 'document-warning', message: 'Dropped rows shelf field.' }],
      }),
    );
    const getWorksheetDiagnostics = vi
      .fn()
      .mockResolvedValue(
        Ok({ worksheets: [{ worksheetId, status: 'complete', invalidFields: [] }] }),
      );
    const executor = makeExecutorMock({
      desktopInstanceId: 'inst-test',
      desktopApiVersion: '0.2.16',
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: liveWorkbook(['Sheet 1']),
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
      applyWorkbookDocument,
      getWorksheetDiagnostics,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.readbackVerification).toMatchObject({ ok: false, status: 'failed' });
      expect(JSON.stringify(result.value.readbackVerification)).toContain(
        'Dropped rows shelf field.',
      );
    }
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).toHaveBeenCalledWith(worksheetId, mockSignal, 'inst-test');
  });

  it('post-apply contract: keeps an artifact document warning as failed verification after native validation', async () => {
    const worksheetId = 'sheet-1';
    const xml = `<worksheet name='${worksheetName}'><simple-id uuid='${worksheetId}'/><table><rows /></table></worksheet>`;
    const baseline = liveWorkbook(['Sheet 1']);
    const dispatchState = { attempted: false };
    const applyWorkbookDocument = vi.fn(
      async (_xml: string, _signal: AbortSignal, options?: { onDispatch?: () => void }) => {
        options?.onDispatch?.();
        return Ok({
          command_id: 'apply-artifact',
          status: 'completed' as const,
          submitted_at: '',
          warnings: [{ code: 'document-warning', message: 'Dropped color encoding.' }],
        });
      },
    );
    const getWorksheetDiagnostics = vi
      .fn()
      .mockResolvedValue(
        Ok({ worksheets: [{ worksheetId, status: 'complete', invalidFields: [] }] }),
      );
    const executor = makeExecutorMock({
      desktopInstanceId: 'inst-build',
      desktopApiVersion: '0.2.16',
      getWorkbookDocument: vi.fn(async () =>
        Ok({ xml: baseline, applicationVersion: undefined, xsdPayloadVersion: undefined }),
      ),
      applyWorkbookDocument,
      getWorksheetDiagnostics,
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      artifactApply: {
        windowXml: `<window class='worksheet' name='${worksheetName}' />`,
        expectedTargetState: captureTargetWorksheetState(baseline, worksheetName, xml),
        expectedInstanceId: 'inst-build',
        dispatchState,
      },
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.readbackVerification).toMatchObject({ ok: false, status: 'failed' });
      expect(JSON.stringify(result.value.readbackVerification)).toContain(
        'Dropped color encoding.',
      );
    }
    expect(dispatchState.attempted).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).toHaveBeenCalledOnce();
    expect(getWorksheetDiagnostics).toHaveBeenCalledWith(worksheetId, mockSignal, 'inst-build');
  });

  it.each(['artifact', 'per-sheet', 'upsert'] as const)(
    'post-apply contract: %s warning merges inline native findings without structural polling or a diagnostics GET',
    async (route) => {
      vi.useFakeTimers();
      try {
        const scenario = inlineDiagnosticsDocumentWarningScenario(route);
        const pending = scenario.run();
        await vi.runAllTimersAsync();
        const result = await pending;

        expect(result.isOk()).toBe(true);
        const report = result.unwrap().readbackVerification;
        expect(report).toMatchObject({
          ok: false,
          status: 'failed',
          findings: expect.arrayContaining([
            expect.objectContaining({
              source: 'readback',
              message: scenario.documentWarning,
            }),
            expect.objectContaining({
              source: 'used-field-validity',
              worksheetId: scenario.expectedWorksheetId,
              fieldName: scenario.nativeFieldName,
            }),
          ]),
        });
        expect(JSON.stringify(report)).not.toContain('[none:Wrong Target:nk]');
        expect(scenario.readbackVerificationOut).toEqual([report]);
        expect(scenario.getWorksheetDiagnostics).not.toHaveBeenCalled();
        expect(scenario.applyWorksheetDocument).toHaveBeenCalledTimes(
          route === 'per-sheet' ? 1 : 0,
        );
        expect(scenario.applyWorkbookDocument).toHaveBeenCalledTimes(route === 'per-sheet' ? 0 : 1);
        expect(scenario.getWorksheetDocument).not.toHaveBeenCalled();
        expect(scenario.getWorkbookDocument).toHaveBeenCalledTimes(route === 'per-sheet' ? 0 : 1);
      } finally {
        vi.useRealTimers();
      }
    },
  );
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
