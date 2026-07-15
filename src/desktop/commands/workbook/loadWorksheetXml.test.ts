import { Err, Ok } from 'ts-results-es';

import * as configModule from '../../../config.desktop.js';
import * as loggerModule from '../../../logging/logger.js';
import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorksheetXml } from './loadWorksheetXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');
vi.mock('../../validation/registry.js');

describe('loadWorksheetXml (Agent API transport, default)', () => {
  const mockSignal = new AbortController().signal;
  const worksheetName = 'Sheet 1';
  const validXml = '<worksheet name="Sheet 1"><table></table></worksheet>';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully load worksheet XML', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          submitted_at: '',
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabui',
        command: 'load-worksheet',
        args: {
          worksheetName,
          worksheetXml: validXml,
        },
      }),
    );
  });

  // A command-dispatching executor: the post-apply readback (W4) re-reads the sheet via
  // `save-worksheet`, so tests that assert focus/apply choreography must serve that call.
  function dispatchingAgentExecutor(
    readbackXml: string,
    overrides: Partial<Record<string, unknown>> = {},
  ): {
    executor: LocalExecutor;
    calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }>;
    executeCommand: ReturnType<typeof vi.fn>;
  } {
    const calls: Array<{ namespace: string; command: string; args?: Record<string, unknown> }> = [];
    const executeCommand = vi.fn(async (params: any) => {
      calls.push({ namespace: params.namespace, command: params.command, args: params.args });
      if (params.command in overrides) return overrides[params.command];
      if (params.command === 'save-worksheet') {
        return Ok({
          command_id: 'cmd-readback',
          status: 'completed',
          submitted_at: '',
          parsedResult: { worksheetXml: readbackXml },
        });
      }
      return Ok({ command_id: 'cmd-ok', status: 'completed', submitted_at: '' });
    });
    return { executor: { executeCommand } as unknown as LocalExecutor, calls, executeCommand };
  }

  it('focuses the worksheet after a successful apply', async () => {
    const { executor, calls } = dispatchingAgentExecutor(validXml);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    // Post-apply readback (W4) runs before focus; focus is the final call.
    expect(calls.some((c) => c.namespace === 'tabui' && c.command === 'save-worksheet')).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { sheet: worksheetName },
    });
  });

  it('keeps worksheet apply successful when focusing the worksheet fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'GOTO_FAILED', message: 'could not navigate', recoverable: true },
    };
    const { executor } = dispatchingAgentExecutor(validXml, { 'goto-sheet': Err(error) });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('goto-sheet'),
        data: expect.objectContaining({
          sheetName: worksheetName,
          appliedVia: 'load-worksheet',
          error,
        }),
      }),
    );
  });

  it('fails the apply (readback-failed) when Tableau silently drops an intent-bearing node', async () => {
    const intended =
      '<worksheet name="Sheet 1"><table>' +
      '<panes><pane><mark class="Shape"/>' +
      '<encodings><lod column="[DS].[none:State:nk]"/></encodings></pane></panes>' +
      '<rows>[DS].[none:State:nk]</rows></table></worksheet>';
    // Readback comes back with the <lod> encoding and the rows shelf stripped.
    const stripped =
      '<worksheet name="Sheet 1"><table>' +
      '<panes><pane><mark class="Shape"/><encodings/></pane></panes></table></worksheet>';
    const { executor } = dispatchingAgentExecutor(stripped);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: intended,
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'readback-failed');
      expect(result.error.error.message).toContain('silently dropped');
      expect(result.error.error.findings.some((f) => f.node === 'lod')).toBe(true);
    }
  });

  it('surfaces readback WARNINGS on a successful apply without failing it', async () => {
    const intended =
      '<worksheet name="Sheet 1"><table>' +
      '<view><computed-sort column="[DS].[none:State:nk]" direction="DESC" using="[DS].[sum:Profit:qk]"/></view>' +
      '<panes><pane><mark class="Bar"/></pane></panes></table></worksheet>';
    // Sort direction changed on readback → warning-severity, non-fatal.
    const changed = intended.replace('direction="DESC"', 'direction="ASC"');
    const { executor } = dispatchingAgentExecutor(changed);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: intended,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.readbackWarnings.some((f) => f.kind === 'sort')).toBe(true);
    }
  });

  it('should return error when XML is invalid', async () => {
    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: 'not xml',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('invalid-xml');
    }
  });

  it('should return error when XML is empty', async () => {
    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: '',
      executor: mockExecutor,
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

    const mockExecutor = {} as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  it('should proceed with warnings but not errors', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: true,
      issues: [{ ruleId: 'test-rule', severity: 'warning', message: 'Deprecated element' }],
    });

    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' })),
    } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(mockExecutor.executeCommand).toHaveBeenCalled();
  });

  it('should return error when executeCommand fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });

  it('should trim whitespace from XML', async () => {
    const xmlWithWhitespace = `\n  ${validXml}\n`;
    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' })),
    } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: xmlWithWhitespace,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(validationRegistry.runValidation).toHaveBeenCalledWith(validXml, 'worksheet');
  });

  it('reports load-rejected when the command completes but Desktop rejected the load', async () => {
    // Mirrors the workbook path: the command reports status:'completed' while the
    // document load itself failed — the failure lives in the result payload.
    const deskError =
      'The load was not able to complete successfully. Qualified Name Parse Error --- ' +
      'Invalid input: mismatched brackets --- Input: [Sample - Superstore].[[Sub-Category]]';
    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-1',
        status: 'completed',
        submitted_at: '',
        result: { success: false, error: { message: deskError } },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'load-rejected');
      expect(result.error.error.message).toContain('Qualified Name Parse Error');
    }
  });

  it('reports load-rejected when the command status carries a top-level error object', async () => {
    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-2',
        status: 'completed',
        submitted_at: '',
        error: {
          code: 'LOAD_FAILED',
          message: 'worksheet could not be loaded',
          recoverable: false,
        },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'load-rejected');
      expect(result.error.error.message).toContain('worksheet could not be loaded');
    }
  });
});

describe('loadWorksheetXml (External Client API transport, TABLEAU_EXTERNAL_API gate)', () => {
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

  // Executor that dispatches by command, recording each call so the fetch-then-apply
  // sequence can be asserted. `save-underlying-metadata` returns the live workbook.
  function dispatchingExecutor(workbookXml: string): {
    executor: LocalExecutor;
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
    return { executor: { executeCommand } as unknown as LocalExecutor, calls };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
    const base = configModule.getDesktopConfig();
    vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...base,
      externalApiEnabled: true,
    });
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

    // The upsert POST overwrites the colliding sheet in place — no delete-sheet step.
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();

    const applyCall = calls.find((c) => c.command === 'load-underlying-metadata');
    expect(applyCall?.namespace).toBe('tabui');
    expect(typeof applyCall?.args?.text).toBe('string');
    // The applied minimal doc carries the edited sheet but not the untouched "Other".
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
    expect(calls.at(-1)).toEqual({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { sheet: worksheetName },
    });
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
      executor: {} as unknown as LocalExecutor,
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
      executor: {} as unknown as LocalExecutor,
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
      executor: {} as unknown as LocalExecutor,
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
    } as unknown as LocalExecutor;

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
