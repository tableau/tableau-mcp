import { Err, Ok } from 'ts-results-es';

import { getMockRequestHandlerExtra } from '../../tools/desktop/toolContext.mock.js';
import { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import * as sessionResolution from '../session/sessionResolution.js';
import { runExternalApiReadTool, runExternalApiTool } from './readHarness.js';

vi.mock('../session/sessionResolution.js');

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

  it('uses the same session, executor, and signal path for an action callback', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const result = await runExternalApiTool({
      session: 'desktop-action',
      extra,
      callback: async (typedExecutor, signal, call, resolvedSession) => {
        expect(typedExecutor).toBe(executor);
        expect(signal).toBe(extra.signal);
        expect(resolvedSession).toBe('999');
        return await call('dialog action', async (actionExecutor, actionSignal) => {
          expect(actionExecutor).toBe(executor);
          expect(actionSignal).toBe(extra.signal);
          return Ok({ outcome: 'dismissed' as const });
        });
      },
    });

    expect(result).toEqual(Ok({ outcome: 'dismissed' }));
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith('desktop-action');
    expect(extra.getExecutor).toHaveBeenCalledWith('999');
  });

  it('wraps command errors as Desktop command execution errors', async () => {
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

  it('appends caller context to errors without changing their classification', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const commandError: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'awaiting-user',
        message: 'The operation is blocked on a Tableau Desktop dialog.',
        recoverable: false,
      },
    };
    const errorContext = 'Operation: parent read attempted a child request.';

    const result = await runExternalApiReadTool({
      session: undefined,
      extra,
      callback: async (_executor, _signal, read) =>
        await read('child request', async () => Err(commandError), { errorContext }),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        type: 'desktop-command-execution-error',
        statusCode: 500,
        blockedByDesktopDialog: true,
      });
      expect(result.error.message).toBe(`${commandError.error?.message}\n${errorContext}`);
    }
  });

  it('wraps action errors as Desktop command execution errors', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const commandError: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'dialog-action-disabled',
        message: 'The matching dialog button is disabled.',
        recoverable: false,
      },
    };

    const result = await runExternalApiTool({
      session: undefined,
      extra,
      callback: async (_executor, _signal, call) =>
        await call('dialog action', async () => Err(commandError)),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('desktop-command-execution-error');
      expect(result.error.message).toBe('The matching dialog button is disabled.');
    }
  });
});
