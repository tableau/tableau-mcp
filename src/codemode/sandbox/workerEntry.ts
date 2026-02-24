import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';

import { HostWorkerMessage, SandboxWorkerMessage } from './types.js';

type WorkerData = {
  code: string;
  spec: unknown;
  operationMap: Record<string, string>;
  maxOutputBytes: number;
};

const hostPort = parentPort;
if (!hostPort) {
  throw new Error('Sandbox worker did not start with a parent port');
}

const { code, spec, operationMap, maxOutputBytes } = workerData as WorkerData;
const logs: Array<string> = [];
let outputBytes = 0;
let apiCalls = 0;
let invokeId = 0;
const pendingCalls = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }
>();

function getSerializedByteLength(value: unknown): number {
  return Buffer.byteLength(
    JSON.stringify(value, (_key, curr) => (typeof curr === 'bigint' ? curr.toString() : curr)),
    'utf8',
  );
}

function pushOutput(value: unknown): void {
  outputBytes += getSerializedByteLength(value);
  if (outputBytes > maxOutputBytes) {
    throw new Error(`Sandbox output exceeds CODE_MODE_MAX_OUTPUT_BYTES (${maxOutputBytes})`);
  }
}

function createConsoleProxy(): Console {
  const append = (method: string, args: Array<unknown>) => {
    const line = `[${method}] ${args.map((part) => String(part)).join(' ')}`.trim();
    logs.push(line);
    pushOutput(line);
  };

  return {
    log: (...args: Array<unknown>) => append('log', args),
    info: (...args: Array<unknown>) => append('info', args),
    warn: (...args: Array<unknown>) => append('warn', args),
    error: (...args: Array<unknown>) => append('error', args),
    debug: (...args: Array<unknown>) => append('debug', args),
  } as Console;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const typedValue = value as Record<string, unknown>;
  for (const key of Object.keys(typedValue)) {
    deepFreeze(typedValue[key]);
  }
  return Object.freeze(value);
}

async function invokeHost(operationId: string, args: unknown): Promise<unknown> {
  apiCalls += 1;
  const id = ++invokeId;
  hostPort.postMessage({
    type: 'invoke',
    id,
    operationId,
    args,
  } satisfies SandboxWorkerMessage);

  return await new Promise((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject });
  });
}

hostPort.on('message', (message: HostWorkerMessage) => {
  if (message.type !== 'invokeResult') {
    return;
  }

  const pending = pendingCalls.get(message.id);
  if (!pending) {
    return;
  }

  pendingCalls.delete(message.id);
  if (message.ok) {
    pending.resolve(message.value);
  } else {
    pending.reject(new Error(message.error ?? 'Unknown sandbox invoke error'));
  }
});

const tableauApi = {
  listOperations: () => Object.keys(operationMap),
  callTool: async (operationId: string, args: unknown) => {
    if (!(operationId in operationMap)) {
      throw new Error(`Unknown operation: ${operationId}`);
    }
    return await invokeHost(operationId, args);
  },
  operations: Object.fromEntries(
    Object.keys(operationMap).map((operationId) => [
      operationId,
      async (args: unknown) => await invokeHost(operationId, args),
    ]),
  ),
};

const contextObject = Object.create(null) as Record<string, unknown>;
contextObject.spec = deepFreeze(spec);
contextObject.tableau = tableauApi;
contextObject.console = createConsoleProxy();

const context = vm.createContext(contextObject, {
  codeGeneration: {
    strings: false,
    wasm: false,
  },
});

async function run(): Promise<void> {
  try {
    const source = `
      (async () => {
        const fn = ${code};
        if (typeof fn !== 'function') {
          throw new Error('Expected "code" to be a JavaScript function expression');
        }
        return await fn();
      })()
    `;
    const script = new vm.Script(source, { filename: 'tmcp-codemode-user-script.js' });
    const result = await script.runInContext(context);
    pushOutput(result);

    hostPort.postMessage({
      type: 'complete',
      result,
      logs,
      apiCalls,
      outputBytes,
    } satisfies SandboxWorkerMessage);
  } catch (error) {
    hostPort.postMessage({
      type: 'error',
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    } satisfies SandboxWorkerMessage);
  }
}

void run();
