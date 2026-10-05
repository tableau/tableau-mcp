/* eslint-disable no-console */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

type JsonObject = Record<string, unknown>;

type SmokeOptions = {
  binaryPath: string;
  requiredTool?: string;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {
      name: 'tableau-mcp-sea-smoke',
      version: '1.0.0',
    },
  },
};

const toolsListRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {},
};

const initializedNotification = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
  params: {},
};

export function buildMcpHandshakeInput(): string {
  const messages: JsonObject[] = [initializeRequest, initializedNotification, toolsListRequest];
  return `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`;
}

export function parseArgs(argv: string[]): SmokeOptions {
  const args = argv.slice(2);
  const binaryPath = args[0];
  if (!binaryPath || binaryPath.startsWith('--')) {
    throw new Error(
      'Usage: npx tsx src/scripts/seaSmoke.ts <binary-path> [--require-tool <tool-name>] [--timeout-ms <ms>]',
    );
  }

  const options: SmokeOptions = { binaryPath };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--require-tool') {
      const requiredTool = args[++i];
      if (!requiredTool || requiredTool.startsWith('--')) {
        throw new Error('--require-tool requires a tool name');
      }
      options.requiredTool = requiredTool;
    } else if (arg === '--timeout-ms') {
      const timeoutMs = Number(args[++i]);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error('--timeout-ms requires a positive integer');
      }
      options.timeoutMs = timeoutMs;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseJsonLine(line: string): JsonObject {
  const parsed: unknown = JSON.parse(line);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON-RPC object, got: ${line}`);
  }
  return parsed as JsonObject;
}

function parseJsonLines(lines: string[]): JsonObject[] {
  return lines.filter((line) => line.trim()).map(parseJsonLine);
}

function getResponse(messages: JsonObject[], id: number): JsonObject | undefined {
  return messages.find((message) => message.id === id);
}

function describeError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error);
  }
  const errorObject = error as { message?: unknown };
  return typeof errorObject.message === 'string' ? errorObject.message : JSON.stringify(error);
}

function assertNoJsonRpcErrors(messages: JsonObject[]): void {
  const errorResponse = messages.find((message) => 'error' in message);
  if (errorResponse) {
    throw new Error(`SEA smoke JSON-RPC error: ${describeError(errorResponse.error)}`);
  }
}

export function requireToolName(outputLines: string[], requiredTool: string): void {
  const messages = parseJsonLines(outputLines);
  assertNoJsonRpcErrors(messages);

  const toolsResponse = getResponse(messages, 2);
  const result = toolsResponse?.result;
  const tools =
    result && typeof result === 'object' && 'tools' in result
      ? (result as { tools?: unknown }).tools
      : undefined;

  if (!Array.isArray(tools)) {
    throw new Error('tools/list did not return a tools array');
  }

  const toolNames = tools
    .map((tool) =>
      tool && typeof tool === 'object' && 'name' in tool
        ? (tool as { name?: unknown }).name
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');

  if (!toolNames.includes(requiredTool)) {
    throw new Error(
      `Required tool '${requiredTool}' was not returned by tools/list. Returned tools: ${toolNames.join(', ')}`,
    );
  }
}

function validateHandshake(
  outputLines: string[],
  { requiredTool }: Pick<SmokeOptions, 'requiredTool'>,
): void {
  const messages = parseJsonLines(outputLines);
  assertNoJsonRpcErrors(messages);

  if (!getResponse(messages, 1)) {
    throw new Error('initialize did not return a response');
  }
  if (!getResponse(messages, 2)) {
    throw new Error('tools/list did not return a response');
  }
  if (requiredTool) {
    requireToolName(outputLines, requiredTool);
  }
}

export async function runSeaSmoke({
  binaryPath,
  requiredTool,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: SmokeOptions): Promise<void> {
  const child = spawn(binaryPath, [], {
    env: { ...process.env, TRANSPORT: 'stdio' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  let timedOut = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const outputLines: string[] = [];
  const pending = new Map<
    number,
    {
      resolve: (message: JsonObject) => void;
      reject: (error: Error) => void;
    }
  >();

  const rejectPending = (error: Error): void => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  const stdoutLines = createInterface({ input: child.stdout });
  stdoutLines.on('line', (line) => {
    if (!line.trim()) return;
    outputLines.push(line);

    let message: JsonObject;
    try {
      message = parseJsonLine(line);
    } catch (error) {
      rejectPending(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    if (typeof message.id !== 'number') return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message);
  });

  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        const error = new Error(
          `SEA smoke process closed before all responses arrived (code ${String(code)} signal ${String(signal)})`,
        );
        rejectPending(error);
        resolve({ code, signal });
      });
    },
  );

  const awaitResponse = async (id: number): Promise<JsonObject> => {
    return await new Promise<JsonObject>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  };

  const writeMessage = (message: JsonObject): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const writeRequestAndAwait = async (message: JsonObject, id: number): Promise<void> => {
    const response = awaitResponse(id);
    writeMessage(message);
    await response;
  };

  const exchange = async (): Promise<void> => {
    await writeRequestAndAwait(initializeRequest, 1);
    writeMessage(initializedNotification);
    await writeRequestAndAwait(toolsListRequest, 2);
    child.stdin.end();
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  try {
    await exchange();
  } catch (error) {
    child.kill();
    clearTimeout(timeout);
    if (timedOut) {
      throw new Error(`SEA smoke timed out after ${timeoutMs}ms. stderr: ${stderr.trim()}`);
    }
    throw error;
  }

  const { code, signal } = await closePromise;
  clearTimeout(timeout);

  if (timedOut) {
    throw new Error(`SEA smoke timed out after ${timeoutMs}ms. stderr: ${stderr.trim()}`);
  }
  if (code !== 0) {
    throw new Error(
      `SEA smoke process exited with code ${String(code)} signal ${String(signal)}. stderr: ${stderr.trim()}`,
    );
  }

  validateHandshake(outputLines, { requiredTool });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  await runSeaSmoke(options);
  console.log(
    `SEA smoke passed for ${options.binaryPath}${options.requiredTool ? `; found ${options.requiredTool}` : ''}`,
  );
}

const invokedAsScript =
  !process.env.VITEST &&
  typeof process.argv[1] === 'string' &&
  /seaSmoke\.(ts|js)$/.test(process.argv[1]);

if (invokedAsScript) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
