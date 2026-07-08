import { Err, Ok } from 'ts-results-es';

import * as configModule from '../../../config.desktop.js';
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
    const base = configModule.getDesktopConfig();
    vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...base,
      externalApiEnabled: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should delete the live dashboard then apply a minimal document that omits worksheets', async () => {
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

    const deleteCall = calls.find((c) => c.command === 'delete-sheet');
    expect(deleteCall).toEqual({
      namespace: 'tabdoc',
      command: 'delete-sheet',
      args: { Sheet: dashboardName },
    });

    const applyCall = calls.find((c) => c.command === 'load-underlying-metadata');
    expect(applyCall?.namespace).toBe('tabui');
    const applied = applyCall?.args?.text as string;
    expect(applied).toContain('name="Sales Dashboard"');
    expect(applied).not.toContain('Other DB');
    // Worksheets are stripped so the additive POST does not duplicate them.
    expect(applied).not.toContain('<worksheet');
  });

  it('should skip the delete when the dashboard does not yet exist', async () => {
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
