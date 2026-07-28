import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../../logging/logger.js';
import invariant from '../../../utils/invariant.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../validation/registry.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

// Focus is a required argument at every write seam. Suites that are not about
// navigation pass the disposition that dispatches nothing.
const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;
vi.mock('../../validation/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../validation/registry.js')>();
  return { ...actual, runValidation: vi.fn() };
});

describe('loadWorkbookXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  const validXml =
    '<?xml version="1.0"?><workbook>' +
    '<worksheets><worksheet name="Sheet 1"><table /></worksheet></worksheets>' +
    '</workbook>';
  const validXmlWithWindows =
    '<?xml version="1.0"?><workbook>' +
    '<worksheets><worksheet name="Sheet 1"><table /></worksheet><worksheet name="Sheet 2"><table /></worksheet></worksheets>' +
    '<windows><window class="worksheet" name="Sheet 1" active="true" maximized="true"/>' +
    '<window class="worksheet" name="Sheet 2"/></windows></workbook>';

  // Executor that records workbook document applies so the External API path is assertable.
  function dispatchingExecutor(): {
    executor: ToolExecutor;
    appliedXml: string[];
  } {
    const appliedXml: string[] = [];
    let liveXml = validXml;
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      appliedXml.push(xml);
      liveXml = xml;
      return Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' });
    });
    const getWorkbookDocument = vi.fn(async () =>
      Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
    );
    return {
      executor: { applyWorkbookDocument, getWorkbookDocument } as unknown as ToolExecutor,
      appliedXml,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies via a single whole-document POST without live-workbook pruning', async () => {
    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);

    expect(appliedXml).toEqual([validXml]);
  });

  it('does not attempt pruning when the whole-document POST fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const appliedXml: string[] = [];
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      appliedXml.push(xml);
      return Err(error);
    });
    const mockExecutor = { applyWorkbookDocument } as unknown as ToolExecutor;

    const result = await loadWorkbookXml({
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
    expect(appliedXml).toEqual([validXml]);
  });

  it('should return error when XML is invalid', async () => {
    const result = await loadWorkbookXml({
      xml: 'not xml',
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error.type).toBe('invalid-xml');
    }
  });

  it('should return error when XML is empty', async () => {
    const result = await loadWorkbookXml({
      xml: '',
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-workbook-xml-error');
    }
  });

  it('should return error when validation fails', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [{ ruleId: 'test-rule', severity: 'error', message: 'Invalid structure' }],
    });

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  it('should return execute-command-error when the apply POST fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const applyWorkbookDocument = vi.fn().mockResolvedValue(Err(error));
    const mockExecutor = { applyWorkbookDocument } as unknown as ToolExecutor;

    const result = await loadWorkbookXml({
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
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('should trim whitespace from XML before validating and applying', async () => {
    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: `\n      ${validXml}\n    `,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(validationRegistry.runValidation).toHaveBeenCalledWith(validXml, 'workbook');
    expect(appliedXml).toEqual([validXml]);
  });

  it('should proceed with warnings but not errors', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: true,
      issues: [{ ruleId: 'test-rule', severity: 'warning', message: 'Deprecated element' }],
    });

    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(appliedXml).toEqual([validXml]);
  });

  it('Miller World Cup repro: telemetry-only parameter findings never block auto-apply', async () => {
    const telemetryIssues = [
      {
        ruleId: 'calc-field-names',
        severity: 'warning' as const,
        message:
          'Non-standard internal name detected (telemetry only): [Parameter 1]. If this field works correctly in Tableau, this warning can be ignored.',
      },
      {
        ruleId: 'calc-field-names',
        severity: 'info' as const,
        message:
          'Non-standard internal name detected (telemetry only): [Parameter 2]. If this field works correctly in Tableau, this warning can be ignored.',
      },
    ];
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      // Reproduce the inconsistent aggregate observed by the live apply boundary:
      // issue severity remains authoritative for deciding whether apply is safe.
      valid: false,
      issues: telemetryIssues,
    });
    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(appliedXml).toEqual([validXml]);
    if (result.isOk()) {
      expect(result.value.validationWarnings).toEqual(telemetryIssues);
    }
  });

  it('returns only real blocking errors when warnings accompany a failed preflight', async () => {
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [
        {
          ruleId: 'calc-field-names',
          severity: 'warning',
          message: 'Non-standard internal name detected (telemetry only): [Parameter 1].',
        },
        {
          ruleId: 'worksheet-missing-window',
          severity: 'error',
          message: 'Worksheet "Sheet 1" has no matching window.',
        },
      ],
    });

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: {} as unknown as ToolExecutor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual([
        expect.objectContaining({
          ruleId: 'worksheet-missing-window',
          severity: 'error',
        }),
      ]);
    }
  });

  it('keeps the primary workbook apply focus-neutral when activation is not requested', async () => {
    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: validXmlWithWindows,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(appliedXml).toEqual([validXmlWithWindows]);
  });
});

// A whole-document POST always moves the view: Tableau picks the destination itself and
// ignores the window flags we post (live probe 2026-07-25 — three content-only applies
// from three different sheets all landed on the same dashboard). These executors model
// that: the document read back after the apply is NOT the document we posted.
describe('loadWorkbookXml focus dispositions', () => {
  const mockSignal = new AbortController().signal;

  function workbookDoc(maximized: string): string {
    return (
      "<?xml version='1.0'?><workbook>" +
      '<worksheets><worksheet name="Sheet 1"><table /></worksheet><worksheet name="Sheet 2"><table /></worksheet></worksheets>' +
      '<dashboards><dashboard name="Dashboard 1"><zones /></dashboard></dashboards>' +
      '<windows>' +
      ['Sheet 1', 'Sheet 2']
        .map(
          (name) =>
            `<window class="worksheet" name="${name}"${name === maximized ? ' maximized="true"' : ''}/>`,
        )
        .join('') +
      `<window class="dashboard" name="Dashboard 1"${maximized === 'Dashboard 1' ? ' maximized="true"' : ''}/>` +
      '</windows></workbook>'
    );
  }

  // Desktop's own post-apply pick, taken from the probe: the dashboard, whatever we posted.
  // A goto-sheet moves the live document, which is what the verify pass reads back —
  // unless `gotoLands` is false, which models a dispatch Desktop dropped.
  function dispatchingExecutor({
    postApplyMaximized = 'Dashboard 1',
    gotoLands = true,
  }: { postApplyMaximized?: string; gotoLands?: boolean } = {}): {
    executor: ToolExecutor;
    gotoSheets: string[];
    reads: () => number;
  } {
    const gotoSheets: string[] = [];
    let maximized = postApplyMaximized;
    let reads = 0;
    const applyWorkbookDocument = vi.fn(async () =>
      Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' }),
    );
    const getWorkbookDocument = vi.fn(async () => {
      reads++;
      return Ok({
        xml: workbookDoc(maximized),
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
      });
    });
    const executeCommand = vi.fn(async (params: { command: string; args: { Sheet: string } }) => {
      if (params.command === 'goto-sheet') {
        gotoSheets.push(params.args.Sheet);
        if (gotoLands) maximized = params.args.Sheet;
      }
      return Ok({ command_id: 'goto', status: 'completed', submitted_at: '' });
    });
    return {
      executor: {
        applyWorkbookDocument,
        getWorkbookDocument,
        executeCommand,
      } as unknown as ToolExecutor,
      gotoSheets,
      reads: () => reads,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({ valid: true, issues: [] });
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('navigates to the artifact the call produced', async () => {
    const { executor, gotoSheets } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: workbookDoc('Sheet 1'),
      focus: { navigate: 'artifact', sheetName: 'Sheet 2' },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(gotoSheets).toEqual(['Sheet 2']);
  });

  it('restores the sheet the user was on before the apply', async () => {
    const { executor, gotoSheets } = dispatchingExecutor();

    // The posted document carries the pre-apply windows, so the sheet the user was on is
    // already on the wire — a restore costs no extra read.
    const result = await loadWorkbookXml({
      xml: workbookDoc('Sheet 2'),
      focus: { navigate: 'restore' },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(gotoSheets).toEqual(['Sheet 2']);
  });

  it('dispatches nothing for an intermediate leg', async () => {
    const { executor, gotoSheets } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: workbookDoc('Sheet 1'),
      focus: { navigate: 'none', reason: 'intermediate-leg' },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(gotoSheets).toEqual([]);
  });

  it('dispatches nothing when the target window is already maximized after the apply', async () => {
    const { executor, gotoSheets } = dispatchingExecutor({ postApplyMaximized: 'Sheet 2' });

    const result = await loadWorkbookXml({
      xml: workbookDoc('Sheet 1'),
      focus: { navigate: 'artifact', sheetName: 'Sheet 2' },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(gotoSheets).toEqual([]);
  });

  it('dispatches nothing when the restore target no longer exists', async () => {
    const { executor, gotoSheets } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml:
        "<?xml version='1.0'?><workbook>" +
        '<worksheets><worksheet name="Sheet 1"><table /></worksheet></worksheets>' +
        '<windows><window class="worksheet" name="Deleted Sheet" maximized="true"/></windows>' +
        '</workbook>',
      focus: { navigate: 'restore' },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(gotoSheets).toEqual([]);
  });

  it('reissues the navigation once when the first dispatch did not land', async () => {
    const { executor, gotoSheets } = dispatchingExecutor({ gotoLands: false });

    const result = await loadWorkbookXml({
      xml: workbookDoc('Sheet 1'),
      focus: { navigate: 'artifact', sheetName: 'Sheet 2' },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(gotoSheets).toEqual(['Sheet 2', 'Sheet 2']);
  });

  it('keeps the apply successful when the navigation command fails', async () => {
    const { executor, gotoSheets } = dispatchingExecutor();
    vi.mocked(executor.executeCommand).mockResolvedValue(
      Err({ type: 'command-timed-out' as const, error: 'goto timeout' }),
    );

    const result = await loadWorkbookXml({
      xml: workbookDoc('Sheet 1'),
      focus: { navigate: 'artifact', sheetName: 'Sheet 2' },
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(gotoSheets).toEqual([]);
  });
});
