import { Err, Ok } from 'ts-results-es';

import * as configModule from '../../../config.desktop.js';
import * as loggerModule from '../../../logging/logger.js';
import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { loadDashboardXml } from './loadDashboardXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('loadDashboardXml (Agent API transport, default)', () => {
  const mockSignal = new AbortController().signal;
  const dashboardName = 'Sales Dashboard';
  const validXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully load dashboard XML', async () => {
    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' })),
    } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabui',
        command: 'load-dashboard',
        args: { dashboardName, dashboardXml: validXml },
      }),
    );
  });

  it('focuses the dashboard after a successful apply', async () => {
    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValueOnce(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' }))
        .mockResolvedValueOnce(
          Ok({ command_id: 'cmd-goto', status: 'completed', submitted_at: '' }),
        ),
    } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(mockExecutor.executeCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        namespace: 'tabdoc',
        command: 'goto-sheet',
        args: { sheet: dashboardName },
        signal: mockSignal,
      }),
    );
  });

  it('keeps dashboard apply successful when focusing the dashboard throws', async () => {
    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValueOnce(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' }))
        .mockRejectedValueOnce(new Error('navigation failed')),
    } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(loggerModule.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('goto-sheet'),
        data: expect.objectContaining({
          sheetName: dashboardName,
          appliedVia: 'load-dashboard',
          error: 'navigation failed',
        }),
      }),
    );
  });

  it('rejects before apply when dashboard_name does not match the XML dashboard name', async () => {
    // Canonical-name gate: the XML root name is the identity Tableau applies. A caller name
    // that disagrees must fail BEFORE apply so goto-sheet can never target a stale/default sheet.
    const executeCommand = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' }));
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName: 'Different Dashboard',
      xml: validXml, // name="Sales Dashboard"
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
      invariant(result.error.error.type === 'name-mismatch');
      // Recovery-oriented (P2a): both names verbatim + a FIX line telling the LLM exactly how to
      // recover (align dashboard_name to the XML name, or edit the <dashboard name> attribute).
      expect(result.error.error.message).toBe(
        'dashboard_name "Different Dashboard" does not match the <dashboard name> in the XML ' +
          '("Sales Dashboard"). FIX: Retry with dashboard_name set to the XML\'s name "Sales Dashboard" — ' +
          'or update the <dashboard name> attribute in the XML to "Different Dashboard" if the caller ' +
          'name is intended.',
      );
    }
    // No apply and no navigation happened.
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('rejects a <workbook>-wrapped payload before apply with a single-fragment recovery error', async () => {
    // P1: a whole-workbook document has no top-level <dashboard> identity to gate on. It passes
    // upstream validation (well-formed) and reaches the resolver, so instead of the misleading
    // `does not match XML dashboard name ""`, the gate must reject with an actionable, non-empty
    // recovery hint. It must NOT be "selected" or applied — the fragment-only contract is enforced
    // downstream by buildMinimalDashboardDoc, so accepting a workbook here would only fail later.
    const executeCommand = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' }));
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;
    const workbookShaped =
      "<?xml version='1.0'?><workbook><dashboards>" +
      '<dashboard name="Sales Dashboard"><zones></zones></dashboard></dashboards>' +
      '<windows><window class="dashboard" name="Sales Dashboard"/></windows></workbook>';

    const result = await loadDashboardXml({
      dashboardName: 'Sales Dashboard',
      xml: workbookShaped,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
      invariant(result.error.error.type === 'name-mismatch');
      expect(result.error.error.message).toContain('single <dashboard name="..."> fragment');
      expect(result.error.error.message).toContain('whole <workbook> document');
      expect(result.error.error.message).toContain('apply-workbook');
      // The old, misleading empty-name mismatch must be gone.
      expect(result.error.error.message).not.toContain('name ""');
    }
    // Never applied and never navigated.
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('passes the gate when the caller arg is NFD and the XML name is NFC (visually identical)', async () => {
    // P2b: "Café" spelled with a precomposed é (NFC) in the XML vs a decomposed e + combining
    // acute (NFD) in the caller arg are visually identical and must not false-mismatch. The
    // canonical name threaded to load + goto-sheet is the name exactly as authored in the XML.
    const nfcName = 'Caf\u00e9'; // é as a single precomposed code point (NFC)
    const nfdName = 'Cafe\u0301'; // e + U+0301 combining acute accent (NFD)
    expect(nfcName).not.toBe(nfdName); // different code points…
    expect(nfcName.normalize('NFC')).toBe(nfdName.normalize('NFC')); // …but NFC-equal
    const nfcXml = `<dashboard name="${nfcName}"><zones></zones></dashboard>`;
    const executeCommand = vi
      .fn()
      .mockResolvedValueOnce(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' }))
      .mockResolvedValueOnce(Ok({ command_id: 'cmd-goto', status: 'completed', submitted_at: '' }));
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName: nfdName,
      xml: nfcXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(executeCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        namespace: 'tabui',
        command: 'load-dashboard',
        args: { dashboardName: nfcName, dashboardXml: nfcXml },
      }),
    );
    expect(executeCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        namespace: 'tabdoc',
        command: 'goto-sheet',
        args: { sheet: nfcName },
      }),
    );
  });

  it('focuses the canonical XML dashboard name (not the raw caller arg) after a matched apply', async () => {
    const executeCommand = vi
      .fn()
      .mockResolvedValueOnce(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' }))
      .mockResolvedValueOnce(Ok({ command_id: 'cmd-goto', status: 'completed', submitted_at: '' }));
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName: '  Sales Dashboard  ', // matches "Sales Dashboard" after trim
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    // The load command and the final goto-sheet both use the canonical, trimmed name.
    expect(mockExecutor.executeCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        namespace: 'tabui',
        command: 'load-dashboard',
        args: { dashboardName: 'Sales Dashboard', dashboardXml: validXml },
      }),
    );
    expect(mockExecutor.executeCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        namespace: 'tabdoc',
        command: 'goto-sheet',
        args: { sheet: 'Sales Dashboard' },
        signal: mockSignal,
      }),
    );
  });

  it('should return invalid-xml error when xml is empty', async () => {
    const mockExecutor = { executeCommand: vi.fn() } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: '   ',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-dashboard-xml-error');
      expect(result.error.error.type).toBe('invalid-xml');
    }
    expect(mockExecutor.executeCommand).not.toHaveBeenCalled();
  });

  it('should return validation-failed error when XML is not well-formed', async () => {
    const mockExecutor = { executeCommand: vi.fn() } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: '<dashboard><unclosed>',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-dashboard-xml-error');
      expect(result.error.error.type).toBe('validation-failed');
      if (result.error.error.type === 'validation-failed') {
        expect(result.error.error.issues.length).toBeGreaterThan(0);
        expect(result.error.error.issues[0].ruleId).toBe('well-formed-xml');
      }
    }
    expect(mockExecutor.executeCommand).not.toHaveBeenCalled();
  });

  it('should return error when executeCommand fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
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

  it('should pass the abort signal to executeCommand', async () => {
    const customSignal = new AbortController().signal;
    const mockExecutor = {
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'cmd-123', status: 'completed', submitted_at: '' })),
    } as unknown as LocalExecutor;

    await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor: mockExecutor,
      signal: customSignal,
    });

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ signal: customSignal }),
    );
  });

  it('reports load-rejected when the command completes but Desktop rejected the load', async () => {
    // Mirrors the workbook path: status:'completed' but the document load failed —
    // the failure is carried in the result payload, not in status.
    const deskError =
      'The load was not able to complete successfully. Qualified Name Parse Error --- ' +
      'Invalid input: mismatched brackets';
    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-1',
        status: 'completed',
        submitted_at: '',
        result: { status: 'failed', message: deskError },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
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
          message: 'dashboard could not be loaded',
          recoverable: false,
        },
      }),
    );
    const mockExecutor = { executeCommand } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-dashboard-xml-error');
      invariant(result.error.error.type === 'load-rejected');
      expect(result.error.error.message).toContain('dashboard could not be loaded');
    }
  });
});

describe('loadDashboardXml (External Client API transport, TABLEAU_EXTERNAL_API gate)', () => {
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
    const base = configModule.getDesktopConfig();
    vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...base,
      externalApiEnabled: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should apply a minimal document that upserts the dashboard and omits worksheets', async () => {
    const { executor, calls } = dispatchingExecutor(
      liveWorkbook(['Sales Dashboard', 'Other DB'], ['Sheet 1']),
    );

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);

    // The upsert POST overwrites the colliding dashboard in place — no delete-sheet step.
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();

    const applyCall = calls.find((c) => c.command === 'load-underlying-metadata');
    expect(applyCall?.namespace).toBe('tabui');
    const applied = applyCall?.args?.text as string;
    expect(applied).toContain('name="Sales Dashboard"');
    expect(applied).not.toContain('Other DB');
    // Worksheets are stripped so the POST leaves the live sheets untouched.
    expect(applied).not.toContain('<worksheet');
  });

  it('focuses the dashboard after a successful minimal-doc apply', async () => {
    const { executor, calls } = dispatchingExecutor(
      liveWorkbook(['Sales Dashboard', 'Other DB'], ['Sheet 1']),
    );

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.at(-1)).toEqual({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { sheet: dashboardName },
    });
  });

  it('does not reject a per-dashboard apply whose minimal document omits live worksheets referenced by zones', async () => {
    const dashboardXml = `<dashboard name='${dashboardName}'><zones><zone name='Sheet 1' /></zones></dashboard>`;
    const { executor, calls } = dispatchingExecutor(
      liveWorkbook(['Sales Dashboard', 'Other DB'], ['Sheet 1']),
    );

    const result = await loadDashboardXml({
      dashboardName,
      xml: dashboardXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    const applyCall = calls.find((c) => c.command === 'load-underlying-metadata');
    expect(applyCall?.args?.text).toContain('name="Sheet 1"');
    expect(applyCall?.args?.text).not.toContain('<worksheet');
  });

  it('should apply a minimal document for a brand-new dashboard', async () => {
    const { executor, calls } = dispatchingExecutor(liveWorkbook(['Some Other DB']));

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(calls.find((c) => c.command === 'delete-sheet')).toBeUndefined();
    expect(calls.find((c) => c.command === 'load-underlying-metadata')).toBeDefined();
  });

  it('should return invalid-xml error when xml is empty', async () => {
    const mockExecutor = { executeCommand: vi.fn() } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: '   ',
      executor: mockExecutor,
      signal: mockSignal,
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
    const mockExecutor = { executeCommand: vi.fn() } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: '<dashboard><unclosed>',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('load-dashboard-xml-error');
      if (result.error.type === 'load-dashboard-xml-error') {
        expect(result.error.error.type).toBe('validation-failed');
        if (result.error.error.type === 'validation-failed') {
          expect(result.error.error.issues.length).toBeGreaterThan(0);
          expect(result.error.error.issues[0].ruleId).toBe('well-formed-xml');
        }
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
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('execute-command-error');
      if (result.error.type === 'execute-command-error') {
        expect(result.error.error).toEqual(error);
      }
    }
  });

  it('should pass the abort signal to executeCommand', async () => {
    const customSignal = new AbortController().signal;
    const { executor } = dispatchingExecutor(liveWorkbook(['Sales Dashboard']));

    await loadDashboardXml({
      dashboardName,
      xml: validXml,
      executor,
      signal: customSignal,
    });

    expect(executor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ signal: customSignal }),
    );
  });
});
