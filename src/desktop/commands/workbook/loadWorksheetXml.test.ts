import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../../logging/logger.js';
import invariant from '../../../utils/invariant.js';
import { normalizeArray, parseXML } from '../../metadata/parser.js';
import type { ParsedWindow } from '../../metadata/types.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

const sheetUpsertMock = vi.hoisted(() => ({
  upsertSheetIntoWorkbook: undefined as
    | undefined
    | ((workbookXml: string, sheetName: string, editedWorksheetXml: string) => string),
}));

vi.mock('../../metadata/sheets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../metadata/sheets.js')>();
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
      return Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' });
    });
    const getWorkbookDocument = vi
      .fn()
      .mockResolvedValue(
        Ok({ xml: workbookXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
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
        listWorksheets: vi
          .fn()
          .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] })),
      } as unknown as ToolExecutor,
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

  it('appends a brand-new sheet while preserving the existing one', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other Sheet']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
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
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
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
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
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
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  it('should return execute-command-error when the workbook fetch fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    const mockExecutor = {
      getWorkbookDocument: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as ToolExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });
});
