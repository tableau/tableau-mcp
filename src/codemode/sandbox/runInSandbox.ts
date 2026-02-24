import vm from 'node:vm';

import { Config } from '../../config.js';

export type RunInSandboxArgs = {
  config: Config;
  code: string;
  spec: unknown;
  operationMap: Record<string, string>;
  invoke: (operationId: string, args: unknown) => Promise<unknown>;
};

export type SandboxRunResult = {
  result: unknown;
  logs: Array<string>;
  apiCalls: number;
  outputBytes: number;
};

export async function runInSandbox({
  config,
  code,
  spec,
  operationMap,
  invoke,
}: RunInSandboxArgs): Promise<SandboxRunResult> {
  try {
    let apiCalls = 0;
    let outputBytes = 0;
    const logs: Array<string> = [];

    function pushOutput(value: unknown): void {
      outputBytes += Buffer.byteLength(
        JSON.stringify(value, (_key, curr) => (typeof curr === 'bigint' ? curr.toString() : curr)),
        'utf8',
      );
      if (outputBytes > config.codeModeMaxOutputBytes) {
        throw new Error(
          `Sandbox output exceeds CODE_MODE_MAX_OUTPUT_BYTES (${config.codeModeMaxOutputBytes})`,
        );
      }
    }

    function deepFreeze<T>(value: T): T {
      if (!value || typeof value !== 'object') {
        return value;
      }
      const obj = value as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        deepFreeze(obj[key]);
      }
      return Object.freeze(value);
    }

    const sandboxConsole = {
      log: (...args: Array<unknown>) => {
        const line = `[log] ${args.map((part) => String(part)).join(' ')}`.trim();
        logs.push(line);
        pushOutput(line);
      },
      info: (...args: Array<unknown>) => {
        const line = `[info] ${args.map((part) => String(part)).join(' ')}`.trim();
        logs.push(line);
        pushOutput(line);
      },
      warn: (...args: Array<unknown>) => {
        const line = `[warn] ${args.map((part) => String(part)).join(' ')}`.trim();
        logs.push(line);
        pushOutput(line);
      },
      error: (...args: Array<unknown>) => {
        const line = `[error] ${args.map((part) => String(part)).join(' ')}`.trim();
        logs.push(line);
        pushOutput(line);
      },
      debug: (...args: Array<unknown>) => {
        const line = `[debug] ${args.map((part) => String(part)).join(' ')}`.trim();
        logs.push(line);
        pushOutput(line);
      },
    };

    const tableau = {
      listOperations: () => Object.keys(operationMap),
      unwrap: (result: unknown) => {
        if (!result || typeof result !== 'object') {
          return result;
        }

        const obj = result as Record<string, unknown>;
        if ('data' in obj) {
          const data = obj.data;
          if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).items)) {
            return (data as Record<string, unknown>).items;
          }
          return data;
        }

        if ('content' in obj) {
          const content = obj.content;
          if (
            content &&
            typeof content === 'object' &&
            Array.isArray((content as Record<string, unknown>).items)
          ) {
            return (content as Record<string, unknown>).items;
          }
          return content;
        }

        return result;
      },
      callTool: async (operationId: string, args: unknown) => {
        if (!(operationId in operationMap)) {
          throw new Error(`Unknown operation: ${operationId}`);
        }
        apiCalls += 1;
        if (apiCalls > config.codeModeMaxApiCalls) {
          throw new Error(`Exceeded CODE_MODE_MAX_API_CALLS (${config.codeModeMaxApiCalls})`);
        }
        return await invoke(operationId, args);
      },
      operations: Object.fromEntries(
        Object.keys(operationMap).map((operationId) => [
          operationId,
          async (args: unknown) => {
            apiCalls += 1;
            if (apiCalls > config.codeModeMaxApiCalls) {
              throw new Error(`Exceeded CODE_MODE_MAX_API_CALLS (${config.codeModeMaxApiCalls})`);
            }
            return await invoke(operationId, args);
          },
        ]),
      ),
    };

    const context = vm.createContext(
      Object.create(null, {
        spec: { value: deepFreeze(spec), enumerable: true },
        tableau: { value: tableau, enumerable: true },
        console: { value: sandboxConsole, enumerable: true },
      }),
      {
        codeGeneration: {
          strings: false,
          wasm: false,
        },
      },
    );

    const script = new vm.Script(
      `
      (async () => {
        const fn = ${code};
        if (typeof fn !== 'function') {
          throw new Error('Expected "code" to be a JavaScript function expression');
        }
        return await fn();
      })()
    `,
      { filename: 'tmcp-codemode-user-script.js' },
    );

    const execution = Promise.resolve(
      script.runInContext(context, {
        timeout: config.codeModeMaxExecutionTimeMs,
      }),
    );
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`Code execution timed out after ${config.codeModeMaxExecutionTimeMs}ms in sandbox`),
          ),
        config.codeModeMaxExecutionTimeMs,
      );
    });
    const result = await Promise.race([execution, timeoutPromise]);
    pushOutput(result);

    return {
      result,
      logs,
      apiCalls,
      outputBytes,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    // Errors thrown from the vm context are from a different realm and may fail `instanceof Error`.
    if (typeof error === 'object' && error !== null) {
      const maybeMessage = 'message' in error ? (error as { message?: unknown }).message : undefined;
      const maybeStack = 'stack' in error ? (error as { stack?: unknown }).stack : undefined;
      if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
        throw new Error(
          typeof maybeStack === 'string' && maybeStack.length > 0
            ? `${maybeMessage}\n${maybeStack}`
            : maybeMessage,
        );
      }
    }

    const serialized =
      (() => {
        try {
          return JSON.stringify(error);
        } catch {
          return String(error);
        }
      })() ?? 'unknown non-Error exception';
    throw new Error(`Sandbox execution failed with non-Error throw: ${serialized}`);
  }
}
