import { Err, Ok } from 'ts-results-es';

import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { loadDashboardXml } from './loadDashboardXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

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

describe('loadDashboardXml', () => {
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
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
