import { Err, Ok } from 'ts-results-es';

import * as loggerModule from '../../logging/logger.js';
import invariant from '../../utils/invariant.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExternalApiToolExecutor } from '../externalApi/executorTypes.js';
import * as validationRegistry from '../validation/registry.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

// Focus is a required argument at every write seam. Suites that are not about
// navigation pass the disposition that dispatches nothing.
const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;
vi.mock('../validation/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../validation/registry.js')>();
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
    executor: ExternalApiToolExecutor;
    appliedXml: string[];
  } {
    const appliedXml: string[] = [];
    let liveXml = validXml;
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      appliedXml.push(xml);
      liveXml = xml;
      return Ok({ command_id: 'cmd', status: 'completed' as const, submitted_at: '' });
    });
    const getWorkbookDocument = vi.fn(async () =>
      Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
    );
    return {
      executor: makeExecutorMock({
        applyWorkbookDocument,
        getWorkbookDocument,
      }),
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
    expect(executor.applyWorkbookDocument).toHaveBeenCalledWith(validXml, mockSignal, undefined);
  });

  it('forwards transactional apply options to the whole-document POST', async () => {
    const { executor } = dispatchingExecutor();
    const onDispatch = vi.fn();
    const applyOptions = { expectedInstanceId: 'inst-expected', onDispatch };

    const result = await loadWorkbookXml({
      xml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
      applyOptions,
    });

    expect(result.isOk()).toBe(true);
    expect(executor.applyWorkbookDocument).toHaveBeenCalledWith(validXml, mockSignal, applyOptions);
  });

  it('accepts a guarded apply when the live workbook still matches the expected workbook', async () => {
    const { executor, appliedXml } = dispatchingExecutor();

    const result = await loadWorkbookXml({
      xml: validXmlWithWindows,
      expectedWorkbookXml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(executor.getWorkbookDocument).toHaveBeenCalledOnce();
    expect(appliedXml).toEqual([validXmlWithWindows]);
  });

  it('refuses a guarded apply before dispatch when the live workbook has drifted', async () => {
    const applyWorkbookDocument = vi.fn();
    const getWorkbookDocument = vi.fn().mockResolvedValue(
      Ok({
        xml: validXmlWithWindows,
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
      }),
    );
    const executor = makeExecutorMock({ applyWorkbookDocument, getWorkbookDocument });

    const result = await loadWorkbookXml({
      xml: validXmlWithWindows,
      expectedWorkbookXml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error).toEqual({ type: 'workbook-drift' });
    }
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('refuses a source-hash guarded apply before dispatch when the live workbook has drifted', async () => {
    const applyWorkbookDocument = vi.fn();
    const getWorkbookDocument = vi.fn().mockResolvedValue(
      Ok({
        xml: validXmlWithWindows,
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
      }),
    );
    const executor = makeExecutorMock({ applyWorkbookDocument, getWorkbookDocument });

    const result = await loadWorkbookXml({
      xml: validXmlWithWindows,
      expectedSourceHash: '912f06601b9eb97f14293fdbcdc6f3d26c5b6c74735610d61fec30a578f9967c',
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error.type).toBe('workbook-drift');
    }
    expect(getWorkbookDocument).toHaveBeenCalledOnce();
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('returns the guarded read failure and does not dispatch', async () => {
    const readError = { type: 'command-timed-out' as const, error: 'Read timed out' };
    const applyWorkbookDocument = vi.fn();
    const getWorkbookDocument = vi.fn().mockResolvedValue(Err(readError));
    const executor = makeExecutorMock({ applyWorkbookDocument, getWorkbookDocument });

    const result = await loadWorkbookXml({
      xml: validXmlWithWindows,
      expectedWorkbookXml: validXml,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(readError);
    }
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('serializes guarded applies and rejects the stale second candidate', async () => {
    const candidateB = validXmlWithWindows;
    const candidateC = validXmlWithWindows.replace('Sheet 2', 'Sheet 3');
    let liveXml = validXml;
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      liveXml = xml;
      return Ok({ command_id: 'cmd', status: 'completed' as const, submitted_at: '' });
    });
    const getWorkbookDocument = vi.fn(async () =>
      Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
    );
    const executor = makeExecutorMock({ applyWorkbookDocument, getWorkbookDocument });

    const [first, second] = await Promise.all([
      loadWorkbookXml({
        xml: candidateB,
        expectedWorkbookXml: validXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      }),
      loadWorkbookXml({
        xml: candidateC,
        expectedWorkbookXml: validXml,
        executor,
        signal: mockSignal,
        focus: NO_FOCUS,
      }),
    ]);

    expect(first.isOk()).toBe(true);
    expect(second.isErr()).toBe(true);
    if (second.isErr()) {
      invariant(second.error.type === 'load-workbook-xml-error');
      expect(second.error.error).toEqual({ type: 'workbook-drift' });
    }
    expect(getWorkbookDocument).toHaveBeenCalledTimes(2);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(applyWorkbookDocument).toHaveBeenCalledWith(candidateB, mockSignal, undefined);
  });

  it('does not attempt pruning when the whole-document POST fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const appliedXml: string[] = [];
    const applyWorkbookDocument = vi.fn(async (xml: string) => {
      appliedXml.push(xml);
      return Err(error);
    });
    const mockExecutor = makeExecutorMock({ applyWorkbookDocument });

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
      executor: makeExecutorMock(),
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
      executor: makeExecutorMock(),
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
      executor: makeExecutorMock(),
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
    }
  });

  it('cached live-relative apply accepts an unchanged preexisting blocker with one live GET', async () => {
    const existing = { ruleId: 'existing', severity: 'error' as const, message: 'already broken' };
    vi.spyOn(validationRegistry, 'runValidation')
      .mockReturnValueOnce({ valid: false, issues: [existing] })
      .mockReturnValueOnce({ valid: false, issues: [existing] });
    const applyWorkbookDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' }));
    const getWorkbookDocument = vi.fn().mockResolvedValue(Ok({ xml: validXml }));
    const executor = makeExecutorMock({ applyWorkbookDocument, getWorkbookDocument });

    const result = await loadWorkbookXml({
      xml: validXml,
      expectedSourceHash: '912f06601b9eb97f14293fdbcdc6f3d26c5b6c74735610d61fec30a578f9967c',
      cachedLiveRelative: true,
      executor,
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.validationWarnings).toEqual([]);
    expect(getWorkbookDocument).toHaveBeenCalledOnce();
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
  });

  it.each([
    ['new', [], [{ ruleId: 'new', severity: 'error' as const, message: 'new blocker' }]],
    [
      'worsened',
      [{ ruleId: 'same', severity: 'error' as const, message: 'same', occurrenceCount: 1 }],
      [{ ruleId: 'same', severity: 'error' as const, message: 'same', occurrenceCount: 2 }],
    ],
  ])(
    'cached live-relative apply blocks a %s finding before POST',
    async (_label, liveIssues, candidateIssues) => {
      vi.spyOn(validationRegistry, 'runValidation')
        .mockReturnValueOnce({ valid: false, issues: candidateIssues })
        .mockReturnValueOnce({ valid: liveIssues.length === 0, issues: liveIssues });
      const applyWorkbookDocument = vi.fn();
      const getWorkbookDocument = vi.fn().mockResolvedValue(Ok({ xml: validXml }));

      const result = await loadWorkbookXml({
        xml: validXml,
        cachedLiveRelative: true,
        executor: makeExecutorMock({ applyWorkbookDocument, getWorkbookDocument }),
        signal: mockSignal,
        focus: NO_FOCUS,
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        invariant(result.error.type === 'load-workbook-xml-error');
        expect(result.error.error).toEqual({ type: 'validation-failed', issues: candidateIssues });
      }
      expect(getWorkbookDocument).toHaveBeenCalledOnce();
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    },
  );

  it('cached live-relative apply checks stale hash before validation and never POSTs', async () => {
    const validation = vi.spyOn(validationRegistry, 'runValidation');
    const applyWorkbookDocument = vi.fn();
    const getWorkbookDocument = vi.fn().mockResolvedValue(Ok({ xml: validXml }));

    const result = await loadWorkbookXml({
      xml: validXml,
      expectedSourceHash: '0'.repeat(64),
      cachedLiveRelative: true,
      executor: makeExecutorMock({ applyWorkbookDocument, getWorkbookDocument }),
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    expect(getWorkbookDocument).toHaveBeenCalledOnce();
    expect(validation).not.toHaveBeenCalled();
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('keeps direct no-baseline validation strict without reading live workbook', async () => {
    const issue = { ruleId: 'strict', severity: 'error' as const, message: 'block direct' };
    vi.spyOn(validationRegistry, 'runValidation').mockReturnValue({
      valid: false,
      issues: [issue],
    });
    const applyWorkbookDocument = vi.fn();
    const getWorkbookDocument = vi.fn();

    const result = await loadWorkbookXml({
      xml: validXml,
      executor: makeExecutorMock({ applyWorkbookDocument, getWorkbookDocument }),
      signal: mockSignal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    expect(getWorkbookDocument).not.toHaveBeenCalled();
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('should return execute-command-error when the apply POST fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Timeout' };
    const applyWorkbookDocument = vi.fn().mockResolvedValue(Err(error));
    const mockExecutor = makeExecutorMock({ applyWorkbookDocument });

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
      executor: makeExecutorMock(),
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
    executor: ExternalApiToolExecutor;
    gotoSheets: string[];
    reads: () => number;
  } {
    const gotoSheets: string[] = [];
    let maximized = postApplyMaximized;
    let reads = 0;
    const applyWorkbookDocument = vi.fn(async () =>
      Ok({ command_id: 'cmd', status: 'completed' as const, submitted_at: '' }),
    );
    const getWorkbookDocument = vi.fn(async () => {
      reads++;
      return Ok({
        xml: workbookDoc(maximized),
        applicationVersion: undefined,
        xsdPayloadVersion: undefined,
      });
    });
    const executeCommand = vi.fn(async (params: any) => {
      if (params.command === 'goto-sheet') {
        gotoSheets.push(params.args.Sheet);
        if (gotoLands) maximized = params.args.Sheet;
      }
      return Ok({ command_id: 'goto', status: 'completed' as const, submitted_at: '' });
    });
    return {
      executor: makeExecutorMock({
        applyWorkbookDocument,
        getWorkbookDocument,
        executeCommand,
      }),
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
