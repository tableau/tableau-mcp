import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getDashboardXml } from './getDashboardXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

function workbookWith(dashboardNames: string[]): string {
  const dashboards = dashboardNames
    .map((name) => `<dashboard name='${name}'><zones /></dashboard>`)
    .join('');
  return `<?xml version='1.0'?><workbook><dashboards>${dashboards}</dashboards></workbook>`;
}

function executorReturning(text: string): LocalExecutor {
  return {
    executeCommand: vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-123',
        status: 'completed',
        parsedResult: { text },
      }),
    ),
  } as unknown as LocalExecutor;
}

describe('getDashboardXml', () => {
  const mockSignal = new AbortController().signal;
  const dashboardName = 'Sales Dashboard';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should slice the requested dashboard out of the whole-workbook document', async () => {
    const mockExecutor = executorReturning(workbookWith(['Sales Dashboard', 'Other Dashboard']));

    const result = await getDashboardXml({
      dashboardName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('<dashboard');
      expect(result.value).toContain('name="Sales Dashboard"');
      expect(result.value).not.toContain('Other Dashboard');
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'save-underlying-metadata',
      args: { 'is-json': false },
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return execute-command-error when the workbook fetch fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Fetch failed' },
    };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await getDashboardXml({
      dashboardName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });

  it('should return no-dashboard-found when the workbook has no matching dashboard', async () => {
    const mockExecutor = executorReturning(workbookWith(['Some Other Dashboard']));

    const result = await getDashboardXml({
      dashboardName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-dashboard-xml-error');
      expect(result.error.error.type).toBe('no-dashboard-found');
      expect(result.error.error.message).toContain(dashboardName);
    }
  });
});
