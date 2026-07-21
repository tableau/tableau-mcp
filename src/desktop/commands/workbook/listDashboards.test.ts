import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../externalApi/types.js';
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

  it('decodes XML entities in dashboard names returned by Desktop', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            dashboards: JSON.stringify({
              count: 2,
              dashboards: [
                { name: 'P&amp;L Overview' },
                { name: 'Revenue &lt; &quot;Gross&quot;' },
              ],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listDashboards({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.dashboards).toEqual(['P&L Overview', 'Revenue < "Gross"']);
    }
  });
});

describe('listDashboards (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  let server: MockExternalApiServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await startMockExternalApiServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('uses the first-class dashboard list endpoint without fetching the workbook document', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await listDashboards({ executor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 1,
        dashboards: ['Executive Dashboard'],
      });
    }

    expect(server.requests.map((request) => request.path)).toEqual(['/v0/workbook/dashboards']);
    expect(server.requests.map((request) => request.path)).not.toContain('/v0/workbook/document');
  });

  it('returns route-missing errors from older Desktop builds', async () => {
    server.setOverride('GET /v0/workbook/dashboards', {
      status: 404,
      body: JSON.stringify({
        code: 'not-found',
        status: 404,
        instance: '/v0/mock',
        title: 'No route matches GET /v0/workbook/dashboards',
        detail: 'No route matches GET /v0/workbook/dashboards',
      }),
    });
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await listDashboards({ executor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('command-failed');
      if (result.error.type === 'command-failed') {
        expect(result.error.error?.code).toBe('not-found');
        expect(result.error.error?.message).toContain('No route matches');
      }
    }
  });
});

const instanceFor = (server: MockExternalApiServer): ExternalApiInstance => ({
  baseUrl: server.baseUrl,
  token: 'valid-token',
  pid: 999,
  instanceId: 'inst-list-dashboards',
  apiVersion: '1.0',
});
