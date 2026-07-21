import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../../logging/logger.js';
import invariant from '../../../utils/invariant.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

vi.mock('../../validation/registry.js');

describe('loadWorksheetXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';
  const validXml = `<worksheet name='${worksheetName}'><table><rows /></table></worksheet>`;

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
    calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }>;
  } {
    const calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }> = [];
    const executeCommand = vi.fn(async (params: any) => {
      calls.push({ namespace: params.namespace, command: params.command, args: params.args });
      if (params.command === 'save-underlying-metadata') {
        return Ok({
          command_id: 'cmd-get',
          status: 'completed',
          parsedResult: { text: workbookXml },
        });
      }
      return Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' });
    });
    return {
      executor: {
        executeCommand,
        listWorksheets: vi
          .fn()
          .mockResolvedValue(Ok({ worksheets: [{ id: 'sheet-1', name: worksheetName }] })),
      } as unknown as ToolExecutor,
      calls,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
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

    const applyCall = calls.find((c) => c.command === 'load-underlying-metadata');
    expect(applyCall?.namespace).toBe('tabui');
    expect(typeof applyCall?.args?.text).toBe('string');
    expect(applyCall?.args?.text).toContain('name="Sheet 1"');
    expect(applyCall?.args?.text).not.toContain('Other');
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
    expect(calls.find((c) => c.command === 'load-underlying-metadata')).toBeDefined();
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
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
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
