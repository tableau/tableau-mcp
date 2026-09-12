import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  assertSuccessfulMcpResult,
  extractFilePath,
  mcpResultText,
  redactSecrets,
  START_TOOL,
  STOP_TOOL,
  SUMMARY_TOOL,
  withTimeout,
} from './smoke-contracts.mjs';

type Options = {
  mcpEntry: string;
  output: string;
  transcript: string;
  logDirectory: string;
  discoveryDirectory: string;
  session: string;
  worksheet: string;
  timeoutMs: number;
};

type TranscriptEntry = {
  timestamp: string;
  direction: 'request' | 'response';
  method: string;
  payload: unknown;
};

function readOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`expected --name value arguments, received ${key ?? '(end)'}`);
    }
    values.set(key.slice(2), value);
  }
  const required = (name: string): string => {
    const value = values.get(name)?.trim();
    if (!value) throw new Error(`missing --${name}`);
    return value;
  };
  const timeoutMs = Number(values.get('timeout-ms') ?? '600000');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000) {
    throw new Error('--timeout-ms must be an integer of at least 5000');
  }
  return {
    mcpEntry: resolve(required('mcp-entry')),
    output: resolve(required('output')),
    transcript: resolve(required('transcript')),
    logDirectory: resolve(required('log-directory')),
    discoveryDirectory: resolve(required('discovery-directory')),
    session: required('session'),
    worksheet: values.get('worksheet')?.trim() || 'se-eval-scratch',
    timeoutMs,
  };
}

function childCommand(entry: string): { command: string; args: string[] } {
  return ['.js', '.mjs', '.cjs'].includes(extname(entry).toLowerCase())
    ? { command: process.execPath, args: [entry] }
    : { command: entry, args: [] };
}

function cleanEnvironment(overrides: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

async function run(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  await mkdir(dirname(options.output), { recursive: true });
  await mkdir(dirname(options.transcript), { recursive: true });
  await mkdir(options.logDirectory, { recursive: true });

  const entries: TranscriptEntry[] = [];
  const record = async (entry: Omit<TranscriptEntry, 'timestamp'>): Promise<void> => {
    const complete = { timestamp: new Date().toISOString(), ...entry };
    entries.push(complete);
    await appendFile(options.transcript, `${JSON.stringify(redactSecrets(complete))}\n`, 'utf8');
  };
  const command = childCommand(options.mcpEntry);
  const transport = new StdioClientTransport({
    ...command,
    env: cleanEnvironment({
      TRANSPORT: 'stdio',
      ENABLED_LOGGERS: 'fileLogger',
      FILE_LOGGER_DIRECTORY: options.logDirectory,
      TABLEAU_EXTERNAL_API_DISCOVERY_DIR: options.discoveryDirectory,
      TABLEAU_DESKTOP_SESSION_ID: options.session,
      TABLEAU_DESKTOP_CALL_TIMEOUT_MS: String(options.timeoutMs),
    }),
  });
  const client = new Client({ name: 'workbook-performance-recording-smoke', version: '1.0.0' });
  let connected = false;
  let started = false;
  let stopped = false;
  let filePath: string | undefined;
  let failure: Error | undefined;
  let cleanupStop: unknown;

  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    await record({
      direction: 'request',
      method: 'tools/call',
      payload: { name, arguments: args },
    });
    const result = await withTimeout(
      client.callTool({ name, arguments: args }),
      options.timeoutMs,
      `${name} MCP call`,
    );
    await record({ direction: 'response', method: 'tools/call', payload: { name, result } });
    assertSuccessfulMcpResult(result, name);
    return result;
  };

  try {
    await withTimeout(client.connect(transport), 30_000, 'MCP stdio connect');
    connected = true;
    await record({ direction: 'request', method: 'tools/list', payload: {} });
    const listed = await withTimeout(client.listTools(), 30_000, 'MCP listTools');
    await record({ direction: 'response', method: 'tools/list', payload: listed });
    const toolNames = listed.tools.map((tool) => tool.name);
    for (const required of [START_TOOL, STOP_TOOL, SUMMARY_TOOL]) {
      if (!toolNames.includes(required)) throw new Error(`MCP tools/list is missing ${required}`);
    }

    await call(START_TOOL, { session: options.session });
    started = true;
    await call(SUMMARY_TOOL, {
      session: options.session,
      worksheetName: options.worksheet,
      maxRows: 200,
    });
    const stopResult = await call(STOP_TOOL, { session: options.session });
    stopped = true;
    filePath = extractFilePath(stopResult) ?? extractFilePath(mcpResultText(stopResult));
    if (!filePath) throw new Error(`${STOP_TOOL} returned no non-empty filePath`);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (connected && started && !stopped) {
      try {
        cleanupStop = await call(STOP_TOOL, { session: options.session });
        filePath = extractFilePath(cleanupStop) ?? extractFilePath(mcpResultText(cleanupStop));
      } catch (error) {
        cleanupStop = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (connected) {
      try {
        await client.close();
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error(String(error));
      }
    }
  }

  const result = redactSecrets({
    success: !failure && stopped && !!filePath,
    session: options.session,
    worksheet: options.worksheet,
    filePath,
    error: failure?.message,
    cleanupStop,
    transcript: options.transcript,
    startedAt: entries.at(0)?.timestamp,
    finishedAt: new Date().toISOString(),
  });
  await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (failure || !stopped || !filePath) process.exitCode = 1;
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
