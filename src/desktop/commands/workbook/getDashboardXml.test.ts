import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../externalApi/types.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getDashboardXml, isRouteMissing } from './getDashboardXml.js';

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

describe('getDashboardXml (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  let server: MockExternalApiServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await startMockExternalApiServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('resolves dashboard name to id and fetches the per-item document', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getDashboardXml({
      dashboardName: 'Executive Dashboard',
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('<dashboard name="Executive Dashboard"');
    }

    expect(server.requests.map((request) => request.path)).toEqual([
      '/v0/workbook/dashboards',
      '/v0/workbook/dashboards/dash-exec/document',
    ]);
    expect(server.requests.map((request) => request.path)).not.toContain('/v0/workbook/document');
  });

  it('accepts dashboard id directly before name matching', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getDashboardXml({
      dashboardName: 'dash-exec',
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    expect(server.requests.at(-1)?.path).toBe('/v0/workbook/dashboards/dash-exec/document');
  });

  it('returns no-dashboard-found when the first-class list has no matching dashboard', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getDashboardXml({
      dashboardName: 'Missing Dashboard',
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-dashboard-xml-error');
      expect(result.error.error.type).toBe('no-dashboard-found');
      expect(result.error.error.message).toContain('Missing Dashboard');
    }
  });

  it('preserves route-missing errors for older Desktop builds', async () => {
    server.setOverride('GET /v0/workbook/dashboards/dash-exec/document', {
      status: 404,
      body: JSON.stringify({
        code: 'not-found',
        status: 404,
        instance: '/v0/mock',
        title: 'No route matches GET /v0/workbook/dashboards/dash-exec/document',
        detail: 'No route matches GET /v0/workbook/dashboards/dash-exec/document',
      }),
    });
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await getDashboardXml({
      dashboardName: 'Executive Dashboard',
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(isRouteMissing(result.error.error)).toBe(true);
    }
  });
});

const instanceFor = (server: MockExternalApiServer): ExternalApiInstance => ({
  baseUrl: server.baseUrl,
  token: 'valid-token',
  pid: 999,
  instanceId: 'inst-dashboard',
  apiVersion: '1.0',
});
