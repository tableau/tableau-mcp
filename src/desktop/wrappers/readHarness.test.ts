import { Err, Ok } from 'ts-results-es';

import { McpToolError } from '../../errors/mcpToolError.js';
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

  it('uses stable not-found and a caller-supplied error for an endpoint with no resource 404', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const customError = new McpToolError({
      type: 'dialog-action-unavailable',
      message: 'This Desktop build cannot dismiss dialogs.',
      statusCode: 404,
    });
    const routeMissing: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'Ninguna ruta coincide con POST /v0/app:invokeDialogAction',
        recoverable: false,
      },
    };

    const result = await runExternalApiTool({
      session: undefined,
      extra,
      callback: async (_executor, _signal, call) =>
        await call('dialog action', async () => Err(routeMissing), {
          routeMissingError: () => customError,
          stableNotFoundMeansRouteMissing: true,
        }),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe(customError.type);
      expect(result.error.message).toBe(customError.message);
      expect(result.error.statusCode).toBe(customError.statusCode);
    }
  });

  it('keeps translated resource not-found errors out of generic route-missing handling', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const resourceMissing: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'No se encontró la hoja solicitada.',
        recoverable: false,
      },
    };

    const result = await runExternalApiReadTool({
      session: undefined,
      extra,
      callback: async (_executor, _signal, read) =>
        await read('worksheet', async () => Err(resourceMissing)),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('desktop-command-execution-error');
      expect(result.error.message).toBe('No se encontró la hoja solicitada.');
    }
  });

  it('does not broaden endpoint-scoped route handling beyond stable not-found', async () => {
    const executor = new ExternalApiToolExecutor({ discover: () => [] });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const conflict: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'dialog-not-found',
        message: 'The exact dialog identity is no longer active.',
        recoverable: false,
      },
    };

    const result = await runExternalApiTool({
      session: undefined,
      extra,
      callback: async (_executor, _signal, call) =>
        await call('dialog action', async () => Err(conflict), {
          stableNotFoundMeansRouteMissing: true,
        }),
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.type).toBe('desktop-command-execution-error');
      expect(result.error.message).toBe('The exact dialog identity is no longer active.');
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

  it('wraps non-route action errors as Desktop command execution errors', async () => {
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
