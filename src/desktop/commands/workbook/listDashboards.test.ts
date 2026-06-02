import { Err, Ok } from 'ts-results-es';

import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { listDashboards } from './listDashboards.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('listDashboards', () => {
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
