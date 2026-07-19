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
      if (params.command === 'list-worksheets') {
        // The pre-focus existence check (modal-killer) polls this; answer
        // with the names present in the applied XML (canonical spellings)
        // unless a test overrides it.
        const xmlNames = [...readbackXml.matchAll(/worksheet name="([^"]*)"/g)].map((m) => m[1]);
        const names = xmlNames.length > 0 ? xmlNames : [worksheetName];
        return Ok({
          command_id: 'cmd-list',
          status: 'completed',
          submitted_at: '',
          parsedResult: {
            worksheets: JSON.stringify({
              count: names.length,
              worksheets: names.map((name) => ({ name })),
            }),
          },
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

  it('skips goto-sheet when the applied sheet never becomes visible (modal-killer)', async () => {
    // goto-sheet at an unknown name throws blocking Desktop modal 47BF7751
    // instead of returning an error — reproduce the async-apply race by
    // answering the existence poll with an empty workbook.
    const { executor, calls } = dispatchingAgentExecutor(validXml, {
      'list-worksheets': Ok({
        command_id: 'cmd-list',
        status: 'completed',
        submitted_at: '',
        parsedResult: {
          worksheets: JSON.stringify({ count: 0, worksheets: [] as Array<{ name: string }> }),
        },
      }),
    });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true); // apply still succeeds
    expect(calls.some((c) => c.command === 'goto-sheet')).toBe(false); // no focus, no modal
  });

  it('suppresses the post-apply goto-sheet when suppressFocus is set (compose-focus seam)', async () => {
    // Plan-owned worksheet apply: the final dashboard apply owns focus, so a parallel worksheet
    // apply must NOT issue its own goto-sheet. The apply + readback still run and still succeed.
    const { executor, calls } = dispatchingAgentExecutor(validXml);

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
      suppressFocus: true,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.some((c) => c.command === 'load-worksheet')).toBe(true);
    expect(calls.some((c) => c.command === 'save-worksheet')).toBe(true); // readback still runs
    expect(calls.some((c) => c.command === 'goto-sheet')).toBe(false); // focus suppressed
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

  it('rejects before apply when worksheet_name does not match the XML worksheet name', async () => {
    // Canonical-name gate: the XML root name is the identity Tableau applies. A caller name
    // that disagrees must fail BEFORE apply so goto-sheet can never target a stale/default sheet.
    const { executor, calls } = dispatchingAgentExecutor(validXml);

    const result = await loadWorksheetXml({
      worksheetName: 'Different Sheet',
      xml: validXml, // name="Sheet 1"
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'name-mismatch');
      // Recovery-oriented (P2a): both names verbatim + a FIX line telling the LLM exactly how to
      // recover (align worksheet_name to the XML name, or edit the <worksheet name> attribute).
      expect(result.error.error.message).toBe(
        'worksheet_name "Different Sheet" does not match the <worksheet name> in the XML ("Sheet 1"). ' +
          'FIX: Retry with worksheet_name set to the XML\'s name "Sheet 1" — or update the <worksheet name> ' +
          'attribute in the XML to "Different Sheet" if the caller name is intended.',
      );
    }
    // No apply and no navigation happened.
    expect(calls.some((c) => c.command === 'load-worksheet')).toBe(false);
    expect(calls.some((c) => c.command === 'goto-sheet')).toBe(false);
  });

  it('rejects a <workbook>-wrapped payload before apply with a single-fragment recovery error', async () => {
    // P1: a whole-workbook document has no top-level <worksheet> identity to gate on. It passes
    // upstream validation (well-formed) and reaches the resolver, so instead of the misleading
    // `does not match XML worksheet name ""`, the gate must reject with an actionable, non-empty
    // recovery hint. It must NOT be "selected" or applied — the fragment-only contract is enforced
    // downstream by buildMinimalSheetDoc, so accepting a workbook here would only fail later.
    const { executor, calls } = dispatchingAgentExecutor(validXml);
    const workbookShaped =
      "<?xml version='1.0'?><workbook><worksheets>" +
      '<worksheet name="Sheet 1"><table></table></worksheet></worksheets>' +
      '<windows><window class="worksheet" name="Sheet 1"/></windows></workbook>';

    const result = await loadWorksheetXml({
      worksheetName: 'Sheet 1',
      xml: workbookShaped,
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-worksheet-xml-error');
      invariant(result.error.error.type === 'name-mismatch');
      expect(result.error.error.message).toContain('single <worksheet name="..."> fragment');
      expect(result.error.error.message).toContain('whole <workbook> document');
      expect(result.error.error.message).toContain('apply-workbook');
      // The old, misleading empty-name mismatch must be gone.
      expect(result.error.error.message).not.toContain('name ""');
    }
    // Never applied and never navigated.
    expect(calls.some((c) => c.command === 'load-worksheet')).toBe(false);
    expect(calls.some((c) => c.command === 'goto-sheet')).toBe(false);
  });

  it('passes the gate when the caller arg is NFD and the XML name is NFC (visually identical)', async () => {
    // P2b: "Café" spelled with a precomposed é (NFC) in the XML vs a decomposed e + combining
    // acute (NFD) in the caller arg are visually identical and must not false-mismatch. The
    // canonical name threaded to load + goto-sheet is the name exactly as authored in the XML.
    const nfcName = 'Caf\u00e9'; // é as a single precomposed code point (NFC)
    const nfdName = 'Cafe\u0301'; // e + U+0301 combining acute accent (NFD)
    expect(nfcName).not.toBe(nfdName); // different code points…
    expect(nfcName.normalize('NFC')).toBe(nfdName.normalize('NFC')); // …but NFC-equal
    const nfcXml = `<worksheet name="${nfcName}"><table></table></worksheet>`;
    const { executor, calls } = dispatchingAgentExecutor(nfcXml);

    const result = await loadWorksheetXml({
      worksheetName: nfdName,
      xml: nfcXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.find((c) => c.command === 'load-worksheet')?.args).toMatchObject({
      worksheetName: nfcName,
    });
    expect(calls.at(-1)).toMatchObject({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { sheet: nfcName },
    });
  });

  it('focuses the canonical XML worksheet name (not the raw caller arg) after a matched apply', async () => {
    const { executor, calls } = dispatchingAgentExecutor(validXml);

    const result = await loadWorksheetXml({
      worksheetName: '  Sheet 1  ', // matches "Sheet 1" after trim
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    // The load command and the final goto-sheet both use the canonical, trimmed name.
    expect(calls.find((c) => c.command === 'load-worksheet')?.args).toMatchObject({
      worksheetName: 'Sheet 1',
    });
    expect(calls.at(-1)).toMatchObject({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { sheet: 'Sheet 1' },
    });
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

  it('reports skipped readback status and logger when post-apply readback is unavailable', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'BUSY', message: 'worksheet busy', recoverable: true },
    };
    const { executor } = dispatchingAgentExecutor(validXml, { 'save-worksheet': Err(error) });

    const result = await loadWorksheetXml({
      worksheetName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.readbackWarnings).toEqual([]);
      expect(result.value.readbackVerification).toMatchObject({
        ok: true,
        status: 'skipped',
      });
    }
    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('readback verification skipped'),
        data: expect.objectContaining({
          worksheetName,
          status: 'skipped',
        }),
      }),
    );
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
      // The load-rejected message is now the classifier's actionable format, not the
      // raw Desktop error: it prefixes the classification and appends a FIX recipe while
      // still preserving Desktop's original text as evidence.
      expect(result.error.error.message).toContain('Apply failed:');
      expect(result.error.error.message).toContain('Qualified Name Parse Error');
      expect(result.error.error.message).toContain('FIX:');
      expect(result.error.error.message).not.toBe(deskError);
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
