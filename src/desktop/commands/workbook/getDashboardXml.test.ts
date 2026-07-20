import { Err, Ok } from 'ts-results-es';

import * as configModule from '../../../config.desktop.js';
import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getDashboardXml } from './getDashboardXml.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('getDashboardXml (Agent API transport, default)', () => {
  const mockSignal = new AbortController().signal;
  const dashboardName = 'Sales Dashboard';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully return dashboard XML', async () => {
    const mockXml = '<dashboard name="Sales Dashboard"><zones></zones></dashboard>';
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: { dashboardXml: mockXml },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getDashboardXml({
      dashboardName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(mockXml);
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'save-dashboard',
      args: { dashboardName },
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return error when executeCommand fails', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'ERROR', message: 'Dashboard not found' },
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

  it('should return no-dashboard-found error when response contains no dashboard element', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: { dashboardXml: '<empty></empty>' },
        }),
      ),
    } as unknown as LocalExecutor;

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

  it('should return multiple-dashboards-found error when response contains more than one dashboard', async () => {
    const mockXml = '<workbook><dashboard name="D1"/><dashboard name="D2"/></workbook>';
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: { dashboardXml: mockXml },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await getDashboardXml({
      dashboardName,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-dashboard-xml-error');
      expect(result.error.error.type).toBe('multiple-dashboards-found');
      expect(result.error.error.message).toContain('2');
    }
  });

  it('should pass dashboardName as arg to save-dashboard command', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: { dashboardXml: '<dashboard name="My DB"/>' },
        }),
      ),
    } as unknown as LocalExecutor;

    await getDashboardXml({ dashboardName: 'My DB', executor: mockExecutor, signal: mockSignal });

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { dashboardName: 'My DB' },
      }),
    );
  });

  it('falls back to the raw escaped Desktop command name for a literal ampersand name', async () => {
    const mockXml = '<dashboard name="P&amp;L Overview"><zones></zones></dashboard>';
    const mockExecutor = {
      executeCommand: vi.fn(async (params: any) => {
        if (params.command === 'list-dashboards') {
          return Ok({
            command_id: 'cmd-list',
            status: 'completed',
            parsedResult: {
              dashboards: JSON.stringify({
                count: 1,
                dashboards: [{ name: 'P&amp;L Overview' }],
              }),
            },
          });
        }
        return Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            dashboardXml: params.args.dashboardName === 'P&amp;L Overview' ? mockXml : '<empty/>',
          },
        });
      }),
    } as unknown as LocalExecutor;

    const result = await getDashboardXml({
      dashboardName: 'P&L Overview',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe(mockXml);
    }
  });
});

describe('getDashboardXml (External Client API transport, TABLEAU_EXTERNAL_API gate)', () => {
  const mockSignal = new AbortController().signal;
  const dashboardName = 'Sales Dashboard';

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
