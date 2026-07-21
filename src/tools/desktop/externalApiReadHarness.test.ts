import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../desktop/externalApi/externalApiToolExecutor.js';
import * as sessionResolution from '../../desktop/sessionResolution.js';
import { ExecuteCommandError } from '../../desktop/toolExecutor/toolExecutor.js';
import { runExternalApiReadTool } from './externalApiReadHarness.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';

vi.mock('../../desktop/sessionResolution.js');

describe('runExternalApiReadTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('resolves the session and passes a typed External API executor to the read callback', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const result = await runExternalApiReadTool({
      toolName: 'get-health',
      session: 'desktop-2',
      extra,
      callback: async (typedExecutor, signal, read) =>
        await read('health', async (readExecutor, readSignal) => {
          expect(typedExecutor).toBe(executor);
          expect(readExecutor).toBe(executor);
          expect(signal).toBe(extra.signal);
          expect(readSignal).toBe(extra.signal);
          return Ok({ healthy: true });
        }),
    });

    expect(result.isOk()).toBe(true);
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith('desktop-2');
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
  });

  it('maps route-missing command errors to honest endpoint 404s', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const routeMissing: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'No route matches GET /v0/workbook/widgets',
        recoverable: false,
      },
    };

    const result = await runExternalApiReadTool({
      toolName: 'list-widgets',
      session: undefined,
      extra,
      callback: async (_executor, _signal, read) =>
        await read('widget list', async () => Err(routeMissing)),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('endpoint-not-in-this-build');
      expect(result.error.statusCode).toBe(404);
      expect(result.error.message).toContain('widget list endpoint');
      expect(result.error.message).toContain('Do not retry');
    }
  });

  it('wraps non-route command errors as Desktop command execution errors', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const commandError: ExecuteCommandError = {
      type: 'unknown',
      error: 'socket closed',
    };

    const result = await runExternalApiReadTool({
      toolName: 'get-health',
      session: undefined,
      extra,
      callback: async (_executor, _signal, read) =>
        await read('health', async () => Err(commandError)),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('desktop-command-execution-error');
      expect(result.error.message).toBe(JSON.stringify(commandError));
    }
  });
});
