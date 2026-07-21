import { Ok } from 'ts-results-es';

import { getDesktopConfig } from '../../../config.desktop.js';
import * as logger from '../../../logging/logger.js';
import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../externalApi/types.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
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
      config: { ...getDesktopConfig(), externalApiEnabled: false },
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

  it('selects the whole-document fallback and logs config/executor disagreement once', async () => {
    const logSpy = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-doc',
        status: 'completed',
        parsedResult: {
          text: '<workbook><worksheets><worksheet name="Sheet From XML"><table /></worksheet></worksheets></workbook>',
        },
      }),
    );
    const executor = makeExecutor(executeCommand);

    const gateway = new WorkbookReadGateway({
      executor,
      signal,
      config: { ...getDesktopConfig(), externalApiEnabled: true },
    });
    const result = await gateway.listWorksheets();

    expect(gateway.mode).toBe('workbook-document');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.worksheets).toEqual(['Sheet From XML']);
    }
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'save-underlying-metadata' }),
    );
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        logger: 'WorkbookReadGateway',
        message: expect.stringContaining('non-External API executor'),
      }),
    );
  });

  it('selects Agent API reads when External API is disabled', async () => {
    const logSpy = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const executeCommand = vi.fn().mockResolvedValue(
      Ok({
        command_id: 'cmd-list',
        status: 'completed',
        parsedResult: {
          worksheets: JSON.stringify({
            count: 1,
            worksheets: [{ name: 'Sheet From Agent API' }],
          }),
        },
      }),
    );
    const executor = makeExecutor(executeCommand);

    const gateway = new WorkbookReadGateway({
      executor,
      signal,
      config: { ...getDesktopConfig(), externalApiEnabled: false },
    });
    const result = await gateway.listWorksheets();

    expect(gateway.mode).toBe('agent-api');
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.worksheets).toEqual(['Sheet From Agent API']);
    }
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'list-worksheets' }),
    );
    expect(logSpy).not.toHaveBeenCalled();
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
