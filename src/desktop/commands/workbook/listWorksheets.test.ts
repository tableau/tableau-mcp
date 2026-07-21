import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../externalApi/types.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { listWorksheets } from './listWorksheets.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('listWorksheets (Agent API transport, default)', () => {
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully return list of worksheets', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: JSON.stringify({
              count: 3,
              worksheets: [{ name: 'Sheet 1' }, { name: 'Sales' }, { name: 'Analysis' }],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 3,
        worksheets: ['Sheet 1', 'Sales', 'Analysis'],
      });
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'list-worksheets',
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('decodes XML entities in worksheet names returned by Desktop', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: JSON.stringify({
              count: 2,
              worksheets: [
                { name: 'P&amp;L Waterfall: Revenue to Net Income' },
                { name: 'Revenue &lt; &quot;Gross&quot;' },
              ],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 2,
        worksheets: ['P&L Waterfall: Revenue to Net Income', 'Revenue < "Gross"'],
      });
    }
  });

  it('should return empty list when no worksheets exist', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: JSON.stringify({
              count: 0,
              worksheets: [],
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 0,
        worksheets: [],
      });
    }
  });

  it('should return error when executeCommand fails', async () => {
    const error = { type: 'command-failed' as const, error: { code: 'ERROR', message: 'Failed' } };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

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
            worksheets: 'invalid json {',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

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
            worksheets: JSON.stringify({
              // Missing required fields
              invalid: 'data',
            }),
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('invalid-response');
    }
  });

  it('should handle empty worksheets string', async () => {
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(
        Ok({
          command_id: 'cmd-123',
          status: 'completed',
          parsedResult: {
            worksheets: '',
          },
        }),
      ),
    } as unknown as LocalExecutor;

    const result = await listWorksheets({ executor: mockExecutor, signal: mockSignal });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('invalid-response');
    }
  });
});

describe('listWorksheets (External Client API transport)', () => {
  const mockSignal = new AbortController().signal;
  let server: MockExternalApiServer;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = await startMockExternalApiServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('uses the first-class worksheet list endpoint without fetching the workbook document', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await listWorksheets({ executor, signal: mockSignal });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        count: 2,
        worksheets: ['Sales by Region', 'Profit by Category'],
      });
    }

    expect(server.requests.map((request) => request.path)).toEqual(['/v0/workbook/worksheets']);
    expect(server.requests.map((request) => request.path)).not.toContain('/v0/workbook/document');
  });

  it('returns route-missing errors from older Desktop builds', async () => {
    server.setOverride('GET /v0/workbook/worksheets', {
      status: 404,
      body: JSON.stringify({
        code: 'not-found',
        status: 404,
        instance: '/v0/mock',
        title: 'No route matches GET /v0/workbook/worksheets',
        detail: 'No route matches GET /v0/workbook/worksheets',
      }),
    });
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    await executor.start();

    const result = await listWorksheets({ executor, signal: mockSignal });

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
  instanceId: 'inst-list-worksheets',
  apiVersion: '1.0',
});
