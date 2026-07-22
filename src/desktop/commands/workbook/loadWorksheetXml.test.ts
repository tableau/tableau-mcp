import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../../logging/logger.js';
import invariant from '../../../utils/invariant.js';
import { normalizeArray, parseXML, serializeXML } from '../../metadata/parser.js';
import type { ParsedWorksheet } from '../../metadata/types.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

const sheetBuilderMock = vi.hoisted(() => ({
  buildMinimalSheetDoc: undefined as
    | undefined
    | ((workbookXml: string, sheetName: string, editedWorksheetXml: string) => string),
}));

vi.mock('../../metadata/sheets.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../metadata/sheets.js')>();
  return {
    ...actual,
    buildMinimalSheetDoc: (workbookXml: string, sheetName: string, editedWorksheetXml: string) =>
      sheetBuilderMock.buildMinimalSheetDoc
        ? sheetBuilderMock.buildMinimalSheetDoc(workbookXml, sheetName, editedWorksheetXml)
        : actual.buildMinimalSheetDoc(workbookXml, sheetName, editedWorksheetXml),
  };
});

describe('loadWorksheetXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';
  const validXml = `<worksheet name='${worksheetName}'><table><rows /></table></worksheet>`;

  function preFixMinimalSheetDocWithoutWorksheetWindow(
    workbookXml: string,
    sheetName: string,
    editedWorksheetXml: string,
  ): string {
    const workbook = parseXML(workbookXml);
    const editedParsed = parseXML(editedWorksheetXml);
    const editedWorksheet = normalizeArray(
      editedParsed.worksheet as ParsedWorksheet | undefined,
    )[0];
    if (!editedWorksheet || editedWorksheet['@_name'] !== sheetName) {
      throw new Error(`Edited XML does not contain a <worksheet name="${sheetName}">`);
    }

    if (!workbook.workbook) workbook.workbook = {};
    if (!workbook.workbook.worksheets) workbook.workbook.worksheets = {};
    workbook.workbook.worksheets.worksheet = editedWorksheet;

    if (!workbook.workbook.windows) workbook.workbook.windows = {};
    const windows = normalizeArray<Record<string, unknown>>(workbook.workbook.windows.window);
    const targetWindow = windows.find(
      (win) => win['@_class'] === 'worksheet' && win['@_name'] === sheetName,
    );
    workbook.workbook.windows.window = (targetWindow ?? {
      class: 'worksheet',
      name: sheetName,
      cards: {},
    }) as any;

    delete workbook.workbook?.dashboards;
    return serializeXML(workbook);
  }

  function liveWorkbook(worksheetNames: string[]): string {
    const worksheets = worksheetNames
      .map((name) => `<worksheet name='${name}'><table /></worksheet>`)
      .join('');
    const windows = worksheetNames
      .map((name) => `<window class='worksheet' name='${name}' />`)
      .join('');
    return `<?xml version='1.0'?><workbook><worksheets>${worksheets}</worksheets><windows>${windows}</windows></workbook>`;
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
    sheetBuilderMock.buildMinimalSheetDoc = undefined;
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should apply a minimal document that upserts the edited sheet without deleting first', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sheet 1', 'Other']));

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
    expect(applyCall?.xml).not.toContain('Other');
  });

  it('focuses the worksheet after a successful minimal-doc apply', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Sheet 1', 'Other']));

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.some((c) => c.command === 'goto-sheet' && c.args?.sheet === worksheetName)).toBe(
      true,
    );
  });

  it('should apply a minimal document for a brand-new sheet', async () => {
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
  });

  it('rejects a pre-fix minimal document whose worksheet window lacks name/class attributes before POST', async () => {
    vi.mocked(validationRegistry.runValidation).mockRestore();
    sheetBuilderMock.buildMinimalSheetDoc = preFixMinimalSheetDocWithoutWorksheetWindow;
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
