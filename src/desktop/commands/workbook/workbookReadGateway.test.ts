import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../externalApi/types.js';
import { ExecuteCommandError, ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import { WorkbookReadGateway } from './workbookReadGateway.js';

const signal = new AbortController().signal;

describe('WorkbookReadGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects first-class External API reads when given an External API executor', async () => {
    const server = await startMockExternalApiServer();
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    const gateway = new WorkbookReadGateway({
      executor,
      signal,
    });

    try {
      const result = await gateway.listWorksheets();

      expect(gateway.mode).toBe('external-api');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.worksheets).toEqual(['Sales by Region', 'Profit by Category']);
      }
      expect(server.requests.map((request) => request.path)).toEqual(['/v0/workbook/worksheets']);
    } finally {
      executor.stop();
      await server.close();
    }
  });

  it('falls back to the External API whole-document read when the worksheet list route is missing', async () => {
    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-doc',
        status: 'completed',
        parsedResult: {
          text: '<workbook><worksheets><worksheet name="Sheet From XML"><table /></worksheet></worksheets></workbook>',
        },
      }),
    );
    const routeMissing: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'No route matches GET /v0/workbook/worksheets',
        recoverable: false,
      },
    };
    const executor = {
      ...makeExecutor(executeCommand),
      listWorksheets: vi.fn().mockResolvedValue(Err(routeMissing)),
    } as unknown as ExternalApiToolExecutor;

    const gateway = new WorkbookReadGateway({
      executor,
      signal,
    });
    const result = await gateway.listWorksheets();

    expect(gateway.mode).toBe('external-api');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.worksheets).toEqual(['Sheet From XML']);
    }
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'save-underlying-metadata' }),
    );
  });
});

function makeExecutor(executeCommand: ToolExecutor['executeCommand']): ToolExecutor {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    isAvailable: vi.fn(() => true),
    executeCommand,
    getEvents: vi.fn(),
  } as unknown as ToolExecutor;
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-workbook-read-gateway',
    apiVersion: '1.0',
  };
}
