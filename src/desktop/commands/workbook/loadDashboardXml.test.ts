import { Err, Ok } from 'ts-results-es';

import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { loadDashboardXml } from './loadDashboardXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('loadDashboardXml', () => {
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
});
