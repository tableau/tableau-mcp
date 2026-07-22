/* eslint-disable no-console */

import { spawn } from 'child_process';

type JsonObject = Record<string, unknown>;

type SmokeOptions = {
  binaryPath: string;
  requiredTool?: string;
  minKnowledgeResources?: number;
  knowledgeSearchQuery?: string;
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

const resourcesListRequest = {
  jsonrpc: '2.0',
  id: 3,
  method: 'resources/list',
  params: {},
};

export function buildMcpHandshakeInput(
  options: Pick<SmokeOptions, 'minKnowledgeResources' | 'knowledgeSearchQuery'> = {},
): string {
  const messages: JsonObject[] = [initializeRequest, toolsListRequest];
  if (options.minKnowledgeResources !== undefined || options.knowledgeSearchQuery !== undefined) {
    messages.splice(1, 0, initializedNotification);
  }
  if (options.minKnowledgeResources !== undefined) {
    messages.push(resourcesListRequest);
  }
  if (options.knowledgeSearchQuery !== undefined) {
    messages.push({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search-knowledge',
        arguments: { query: options.knowledgeSearchQuery, limit: 3 },
      },
    });
  }
  return `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`;
}

export function parseArgs(argv: string[]): SmokeOptions {
  const args = argv.slice(2);
  const binaryPath = args[0];
  if (!binaryPath || binaryPath.startsWith('--')) {
    throw new Error(
      'Usage: npx tsx src/scripts/seaSmoke.ts <binary-path> [--require-tool <tool-name>] [--min-knowledge-resources <count>] [--search-knowledge <query>] [--timeout-ms <ms>]',
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
    } else if (arg === '--min-knowledge-resources') {
      const minKnowledgeResources = Number(args[++i]);
      if (!Number.isInteger(minKnowledgeResources) || minKnowledgeResources <= 0) {
        throw new Error('--min-knowledge-resources requires a positive integer');
      }
      options.minKnowledgeResources = minKnowledgeResources;
    } else if (arg === '--search-knowledge') {
      const knowledgeSearchQuery = args[++i];
      if (!knowledgeSearchQuery || knowledgeSearchQuery.startsWith('--')) {
        throw new Error('--search-knowledge requires a query');
      }
      options.knowledgeSearchQuery = knowledgeSearchQuery;
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

export function requireMinimumKnowledgeResources(outputLines: string[], minimum: number): void {
  const messages = parseJsonLines(outputLines);
  assertNoJsonRpcErrors(messages);
  const resourcesResponse = getResponse(messages, 3);
  const result = resourcesResponse?.result;
  const resources =
    result && typeof result === 'object' && 'resources' in result
      ? (result as { resources?: unknown }).resources
      : undefined;
  if (!Array.isArray(resources)) {
    throw new Error('resources/list did not return a resources array');
  }
  const knowledgeCount = resources.filter(
    (resource) =>
      resource &&
      typeof resource === 'object' &&
      'uri' in resource &&
      typeof (resource as { uri?: unknown }).uri === 'string' &&
      (resource as { uri: string }).uri.startsWith('expertise://tableau/'),
  ).length;
  if (knowledgeCount < minimum) {
    throw new Error(`Expected at least ${minimum} knowledge resources, got ${knowledgeCount}`);
  }
}

export function requireKnowledgeSearchHit(outputLines: string[]): void {
  const messages = parseJsonLines(outputLines);
  assertNoJsonRpcErrors(messages);
  const searchResponse = getResponse(messages, 4);
  const result = searchResponse?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('search-knowledge did not return a result');
  }
  if ((result as { isError?: unknown }).isError === true) {
    throw new Error(`search-knowledge returned an error: ${JSON.stringify(result)}`);
  }
  const content = (result as { content?: unknown }).content;
  const first = Array.isArray(content) ? content[0] : undefined;
  if (
    !first ||
    typeof first !== 'object' ||
    !('text' in first) ||
    typeof (first as { text?: unknown }).text !== 'string'
  ) {
    throw new Error('search-knowledge did not return text content');
  }
  const payload: unknown = JSON.parse((first as { text: string }).text);
  const hits =
    payload && typeof payload === 'object' && 'hits' in payload
      ? (payload as { hits?: unknown }).hits
      : undefined;
  if (!Array.isArray(hits) || hits.length === 0) {
    throw new Error('search-knowledge returned no hits');
  }
  const topHit = hits[0];
  if (
    !topHit ||
    typeof topHit !== 'object' ||
    !('mustReadUri' in topHit) ||
    typeof (topHit as { mustReadUri?: unknown }).mustReadUri !== 'string'
  ) {
    throw new Error('search-knowledge top hit did not include mustReadUri');
  }
}

function validateHandshake(
  outputLines: string[],
  {
    requiredTool,
    minKnowledgeResources,
    knowledgeSearchQuery,
  }: Pick<SmokeOptions, 'requiredTool' | 'minKnowledgeResources' | 'knowledgeSearchQuery'>,
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
  if (minKnowledgeResources !== undefined) {
    requireMinimumKnowledgeResources(outputLines, minKnowledgeResources);
  }
  if (knowledgeSearchQuery !== undefined) {
    requireKnowledgeSearchHit(outputLines);
  }
}

export async function runSeaSmoke({
  binaryPath,
  requiredTool,
  minKnowledgeResources,
  knowledgeSearchQuery,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: SmokeOptions): Promise<void> {
  const child = spawn(binaryPath, [], {
    env: { ...process.env, TRANSPORT: 'stdio' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);

  child.stdin.end(buildMcpHandshakeInput({ minKnowledgeResources, knowledgeSearchQuery }));

  const { code, signal } = await closePromise;
  clearTimeout(timeout);

  const outputLines = stdout.split(/\r?\n/).filter((line) => line.trim());
  if (timedOut) {
    throw new Error(`SEA smoke timed out after ${timeoutMs}ms. stderr: ${stderr.trim()}`);
  }
  if (code !== 0) {
    throw new Error(
      `SEA smoke process exited with code ${String(code)} signal ${String(signal)}. stderr: ${stderr.trim()}`,
    );
  }

  validateHandshake(outputLines, {
    requiredTool,
    minKnowledgeResources,
    knowledgeSearchQuery,
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  await runSeaSmoke(options);
  console.log(
    `SEA smoke passed for ${options.binaryPath}${options.requiredTool ? `; found ${options.requiredTool}` : ''}${options.minKnowledgeResources ? `; knowledge resources >= ${options.minKnowledgeResources}` : ''}${options.knowledgeSearchQuery ? '; knowledge search returned a hit' : ''}`,
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
