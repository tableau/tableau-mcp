import { Err, Ok } from 'ts-results-es';

import * as configModule from '../../../config.desktop.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { listDashboards } from './listDashboards.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('listDashboards (Agent API transport, default)', () => {
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully return list of dashboards', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            dashboards: JSON.stringify({
              count: 2,
              dashboards: [{ name: 'Sales Dashboard' }, { name: 'Executive Summary' }],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 2,
        dashboards: ['Sales Dashboard', 'Executive Summary'],
      });
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'list-dashboards',
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return empty list when no dashboards exist', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            dashboards: JSON.stringify({
              count: 0,
              dashboards: [],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 0,
        dashboards: [],
      });
    }
  });

  it('should return error when executeCommand fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Command timeout' };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(error);
    }
  });

  it('should return error when JSON parsing fails', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            dashboards: 'not valid json',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('invalid-response');
    }
  });

  it('should return error when schema validation fails', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            dashboards: JSON.stringify({
              // Wrong structure - dashboards is not an array
              count: 'invalid',
              dashboards: 'not-an-array',
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('invalid-response');
    }
  });

  it('should handle dashboard names with special characters', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            dashboards: JSON.stringify({
              count: 3,
              dashboards: [
                { name: 'Dashboard & Analysis' },
                { name: 'Sales: Q1-Q4' },
                { name: "CEO's Report" },
              ],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dashboards).toEqual([
        'Dashboard & Analysis',
        'Sales: Q1-Q4',
        "CEO's Report",
      ]);
    }
  });
});

describe('listDashboards (External Client API transport, TABLEAU_EXTERNAL_API gate)', () => {
  const mockSignal = new AbortController().signal;

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

  it('should return dashboard names sliced from the whole-workbook document', async () => {
    const mockExecutor = executorReturning(workbookWith(['Sales Dashboard', 'Executive Summary']));

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 2,
        dashboards: ['Sales Dashboard', 'Executive Summary'],
      });
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'save-underlying-metadata',
      args: { 'is-json': false },
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('should return empty list when no dashboards exist', async () => {
    const mockExecutor = executorReturning('<?xml version="1.0"?><workbook></workbook>');

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({ count: 0, dashboards: [] });
    }
  });

  it('should return error when the workbook fetch fails', async () => {
    const error = { type: 'command-timed-out' as const, error: 'Command timeout' };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual(error);
    }
  });

  it('should return invalid-response when the workbook XML cannot be parsed', async () => {
    const mockExecutor = executorReturning('not valid xml <<<');

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('invalid-response');
    }
  });

  it('should handle dashboard names with special characters', async () => {
    const mockExecutor = executorReturning(
      workbookWith(['Dashboard &amp; Analysis', 'Sales: Q1-Q4', 'CEO&apos;s Report']),
    );

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dashboards).toEqual([
        'Dashboard & Analysis',
        'Sales: Q1-Q4',
        "CEO's Report",
      ]);
    }
  });
});
