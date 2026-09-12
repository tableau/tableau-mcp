#!/usr/bin/env node
/* eslint-disable no-console */

import { ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

import { apiVersionAtLeast } from '../desktop/externalApi/apiVersion.js';
import { discoverInstances } from '../desktop/externalApi/discovery.js';
import { ExternalApiHttp } from '../desktop/externalApi/externalApiHttp.js';
import {
  apiRootSchema,
  appInfoSchema,
  EXTERNAL_API_ROUTES,
  ExternalApiInstance,
  healthSchema,
  WorkbookOptimizerResult,
} from '../desktop/externalApi/types.js';
import {
  ExpectedRule,
  extractWorkbookOptimizerResult,
  isWorkbookOptimizerToolName,
  OptimizerValidationSummary,
  parseExpectedRules,
  readManifestRuleIds,
  validateDesktopRouteLog,
  validateWorkbookOptimizerResult,
  workbookOptimizerToolName,
} from './workbookOptimizerSmokeValidation.js';

type Scenario = 'direct' | 'backend' | 'ui';

type SmokeOptions = {
  run: boolean;
  scenarios: Set<Scenario>;
  sessionPid?: number;
  mcpPath: string;
  monolithRoot: string;
  workbookPath: string;
  rulesManifestPath: string;
  expectedWorkbookTitle: string;
  expectedRules: ExpectedRule[];
  agentRoot: string;
  agentExecutable?: string;
  agentWsUrl?: string;
  agentWsToken?: string;
  cdpPort: number;
  timeoutMs: number;
  outputDirectory: string;
};

type DesktopContext = {
  instance: ExternalApiInstance;
  client: ExternalApiHttp;
  desktopLogPath: string;
  manifestRuleIds: number[];
};

type NetworkFrame = {
  timestamp: string;
  direction: 'sent' | 'received';
  payload: string;
};

type CdpTarget = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
};

type CdpProbe = {
  hasComposer: boolean;
  hasWelcomeButton: boolean;
  title: string;
  url: string;
  visibility: string;
};

const scriptDirectory =
  typeof __dirname === 'string' ? __dirname : resolve(process.cwd(), 'src', 'scripts');
const repoRoot = resolve(scriptDirectory, '..', '..');
const defaultMonolithRoot = process.env.MONOLITH_DIR
  ? resolve(process.env.MONOLITH_DIR)
  : resolve(repoRoot, '..', 'monolith');
const defaultAgentRoot = process.env.TAB_AGENT_SOUTH_DIR
  ? resolve(process.env.TAB_AGENT_SOUTH_DIR)
  : resolve(repoRoot, '..', 'tab-agent-south');
const optimizerRoute = EXTERNAL_API_ROUTES.workbookRunWorkbookOptimizer;
const defaultExpectedRules = '5:FAIL,6:NEEDS_REVIEW,20:NEEDS_REVIEW';
const composerSelector = '[data-tb-test-id="User-Input-Text-Area-TextArea"]';
const sendButtonSelector = '[data-tb-test-id="User-Input-Send-Button"]';
const welcomeButtonSelector = '[data-tb-test-id="Got-It-Button"]';
const timestampForPath = (): string => new Date().toISOString().replace(/[:.]/g, '-');

const HELP = `Workbook Optimizer full-product smoke test

The command is inert unless --run is present. Without --run it validates local inputs and
prints the exact scenarios that would execute.

Usage:
  npm run smoke:workbook-optimizer -- [--run] [options]

Options:
  --scenario <all|direct|backend|ui>  Scenario(s) to run; repeatable (default: all)
  --session <desktop-pid>             Pin a running Tableau Desktop instance
  --mcp-path <path>                   Built tableau-mcp desktop JS/SEA executable
  --monolith-root <path>              Monolith checkout used for the test fixture
  --workbook <path>                   Expected open workbook (.twb/.twbx)
  --rules-manifest <path>             Installed npm package native rules manifest
  --expected-workbook-title <title>   Workbook title returned by get-workbook-inventory
  --expected-rules <oracle>            Comma-separated id:status entries
  --agent-root <path>                 tab-agent-south checkout
  --agent-executable <path>           Built tab-agent-south executable (source fallback: uv)
  --agent-ws-url <url>                Attach to an existing backend instead of spawning one
  --agent-ws-token-env <name>         Env var holding that backend's WS token
  --cdp-port <port>                   Tableau WebEngine remote-debugging port (default: 9333)
  --timeout-ms <ms>                   Per-agent-turn timeout (default: 600000)
  --output-dir <path>                 Receipt root
  --help                              Show this help

Representative workbook oracle:
  rule 5  FAIL          unused fields
  rule 6  NEEDS_REVIEW  more than ten visible sheets
  rule 20 NEEDS_REVIEW  conditional filters
`;

function parseArgs(argv: string[]): SmokeOptions {
  let monolithRoot = defaultMonolithRoot;
  let workbookPath: string | undefined;
  let rulesManifestPath: string | undefined;
  let expectedWorkbookTitle = 'WorkbookAnalyzerSuperstore';
  let expectedRules = parseExpectedRules(defaultExpectedRules);
  let mcpPath = resolve(repoRoot, 'build', 'index.desktop.js');
  let agentRoot = defaultAgentRoot;
  let agentExecutable: string | undefined;
  let agentWsUrl: string | undefined;
  let agentWsToken: string | undefined;
  let sessionPid: number | undefined;
  let cdpPort = 9333;
  let timeoutMs = 600_000;
  let outputDirectory = resolve(
    repoRoot,
    'smoke-results',
    'workbook-optimizer',
    timestampForPath(),
  );
  let run = false;
  const scenarios = new Set<Scenario>();

  const args = argv.slice(2);
  const next = (flag: string, index: number): string => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--run') {
      run = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (arg === '--scenario') {
      const value = next(arg, index++);
      if (value === 'all') {
        scenarios.add('direct');
        scenarios.add('backend');
        scenarios.add('ui');
      } else if (value === 'direct' || value === 'backend' || value === 'ui') {
        scenarios.add(value);
      } else {
        throw new Error(`Unknown scenario "${value}".`);
      }
    } else if (arg === '--session') {
      sessionPid = positiveInteger(next(arg, index++), arg);
    } else if (arg === '--mcp-path') {
      mcpPath = resolve(next(arg, index++));
    } else if (arg === '--monolith-root') {
      monolithRoot = resolve(next(arg, index++));
    } else if (arg === '--workbook') {
      workbookPath = resolve(next(arg, index++));
    } else if (arg === '--rules-manifest') {
      rulesManifestPath = resolve(next(arg, index++));
    } else if (arg === '--expected-workbook-title') {
      expectedWorkbookTitle = next(arg, index++);
    } else if (arg === '--expected-rules') {
      expectedRules = parseExpectedRules(next(arg, index++));
    } else if (arg === '--agent-root') {
      agentRoot = resolve(next(arg, index++));
    } else if (arg === '--agent-executable') {
      agentExecutable = resolve(next(arg, index++));
    } else if (arg === '--agent-ws-url') {
      agentWsUrl = next(arg, index++);
    } else if (arg === '--agent-ws-token-env') {
      const envName = next(arg, index++);
      agentWsToken = process.env[envName];
      if (!agentWsToken) {
        throw new Error(`${arg} named ${envName}, but that environment variable is empty.`);
      }
    } else if (arg === '--cdp-port') {
      cdpPort = positiveInteger(next(arg, index++), arg);
    } else if (arg === '--timeout-ms') {
      timeoutMs = positiveInteger(next(arg, index++), arg);
    } else if (arg === '--output-dir') {
      outputDirectory = resolve(next(arg, index++));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (scenarios.size === 0) {
    scenarios.add('direct');
    scenarios.add('backend');
    scenarios.add('ui');
  }

  workbookPath ??= resolve(
    monolithRoot,
    'product-tests/data/server/workbooks/MttW/WorkbookOptimizer/WorkbookAnalyzerSuperstore.twbx',
  );
  rulesManifestPath ??= resolve(
    monolithRoot,
    'modules/web/plugin-host-desktop/node_modules/@tableau/workbook-analyzer-rules/src/native/rules-manifest.json',
  );

  return {
    run,
    scenarios,
    sessionPid,
    mcpPath,
    monolithRoot,
    workbookPath,
    rulesManifestPath,
    expectedWorkbookTitle,
    expectedRules,
    agentRoot,
    agentExecutable,
    agentWsUrl,
    agentWsToken,
    cdpPort,
    timeoutMs,
    outputDirectory,
  };
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function requireFile(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function requireDirectory(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const handle = openSync(path, 'a');
  try {
    writeFileSync(handle, `${JSON.stringify(value)}\n`);
  } finally {
    closeSync(handle);
  }
}

function safeOptions(options: SmokeOptions): Record<string, unknown> {
  return {
    run: options.run,
    scenarios: [...options.scenarios],
    sessionPid: options.sessionPid,
    mcpPath: options.mcpPath,
    monolithRoot: options.monolithRoot,
    workbookPath: options.workbookPath,
    rulesManifestPath: options.rulesManifestPath,
    expectedWorkbookTitle: options.expectedWorkbookTitle,
    expectedRules: options.expectedRules,
    agentRoot: options.agentRoot,
    agentExecutable: options.agentExecutable,
    agentWsUrl: options.agentWsUrl ? sanitizeUrl(options.agentWsUrl) : undefined,
    agentWsTokenConfigured: Boolean(options.agentWsToken),
    cdpPort: options.cdpPort,
    timeoutMs: options.timeoutMs,
    outputDirectory: options.outputDirectory,
  };
}

function staticPreflight(options: SmokeOptions): number[] {
  requireFile(options.mcpPath, 'Built tableau-mcp desktop artifact');
  requireDirectory(options.monolithRoot, 'Monolith checkout');
  requireFile(options.workbookPath, 'Workbook Optimizer smoke workbook');
  if (!['.twb', '.twbx'].includes(extname(options.workbookPath).toLowerCase())) {
    throw new Error(`Smoke workbook must be .twb or .twbx: ${options.workbookPath}`);
  }
  requireFile(options.rulesManifestPath, 'Workbook Optimizer npm rules manifest');
  requireDirectory(options.agentRoot, 'tab-agent-south checkout');
  if (options.agentExecutable) {
    requireFile(options.agentExecutable, 'tab-agent-south executable');
  }

  const manifestRuleIds = readManifestRuleIds(readJson(options.rulesManifestPath));
  for (const expected of options.expectedRules) {
    if (!manifestRuleIds.includes(expected.ruleId)) {
      throw new Error(
        `Fixture oracle expects rule ${expected.ruleId}, but the npm manifest does not declare it.`,
      );
    }
  }
  return manifestRuleIds;
}

function selectDesktopInstance(
  instances: ExternalApiInstance[],
  pinnedPid?: number,
): ExternalApiInstance {
  if (pinnedPid !== undefined) {
    const selected = instances.find(({ pid }) => pid === pinnedPid);
    if (!selected) {
      throw new Error(
        `No live External Client API discovery record for Desktop pid ${pinnedPid}. ` +
          `Live pids: ${instances.map(({ pid }) => pid).join(', ') || 'none'}.`,
      );
    }
    return selected;
  }
  if (instances.length !== 1) {
    throw new Error(
      `Expected one live Tableau Desktop instance, found ${instances.length}. ` +
        `Use --session <pid>. Live pids: ${instances.map(({ pid }) => pid).join(', ') || 'none'}.`,
    );
  }
  return instances[0];
}

async function prepareDesktop(
  options: SmokeOptions,
  manifestRuleIds: number[],
): Promise<DesktopContext> {
  const instance = selectDesktopInstance(discoverInstances(), options.sessionPid);
  const client = new ExternalApiHttp(instance, { pollDeadlineMs: options.timeoutMs });
  const health = await client.getJson(EXTERNAL_API_ROUTES.health, healthSchema);
  if (health.isErr() || health.value.status?.toUpperCase() !== 'OK') {
    throw new Error(`Desktop External Client API health check failed: ${JSON.stringify(health)}`);
  }
  const root = await client.getJson(EXTERNAL_API_ROUTES.root, apiRootSchema);
  if (root.isErr()) {
    throw new Error(`Desktop External Client API root failed: ${JSON.stringify(root.error)}`);
  }
  const apiVersion = root.value.apiVersion ?? instance.apiVersion;
  if (!apiVersionAtLeast(apiVersion, '0.2.14')) {
    throw new Error(`Desktop API ${apiVersion ?? '<missing>'} is below required version 0.2.14.`);
  }
  const app = await client.getJson(EXTERNAL_API_ROUTES.app, appInfoSchema);
  if (app.isErr() || !app.value.logLocation) {
    throw new Error(
      `GET /v0/app did not return Desktop logLocation: ${JSON.stringify(app.isErr() ? app.error : app.value)}`,
    );
  }

  const specResponse = await fetch(new URL(EXTERNAL_API_ROUTES.openapi, instance.baseUrl), {
    headers: { Authorization: `Bearer ${instance.token}` },
  });
  if (!specResponse.ok) {
    throw new Error(`GET /openapi.json failed with HTTP ${specResponse.status}.`);
  }
  const openApi = (await specResponse.json()) as {
    info?: { version?: unknown };
    paths?: Record<string, { post?: unknown }>;
  };
  const openApiVersion = openApi.info?.version;
  if (typeof openApiVersion !== 'string' || !apiVersionAtLeast(openApiVersion, '0.2.14')) {
    throw new Error(
      `Desktop OpenAPI version ${String(openApiVersion ?? '<missing>')} is below required version 0.2.14.`,
    );
  }
  if (!openApi.paths?.[optimizerRoute]?.post) {
    throw new Error(`Desktop OpenAPI does not advertise POST ${optimizerRoute}.`);
  }

  const desktopLogPath = join(app.value.logLocation, 'log.txt');
  requireFile(desktopLogPath, 'Desktop log');
  writeJson(join(options.outputDirectory, 'preflight.json'), {
    desktop: {
      pid: instance.pid,
      instanceId: instance.instanceId,
      baseUrl: instance.baseUrl,
      apiVersion,
      applicationVersion: root.value.applicationVersion,
      openApiVersion,
      logPath: desktopLogPath,
    },
    manifestRuleIds,
    options: safeOptions(options),
  });

  return { instance, client, desktopLogPath, manifestRuleIds };
}

function environmentWithOverrides(overrides: Record<string, string>): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return { ...env, ...overrides };
}

class SmokeMcpClient {
  private readonly client = new Client({ name: 'workbook-optimizer-smoke', version: '1.0.0' });
  private readonly transport: StdioClientTransport;
  private readonly stderrPath: string;

  constructor({
    mcpPath,
    desktopPid,
    logDirectory,
    stderrPath,
  }: {
    mcpPath: string;
    desktopPid: number;
    logDirectory: string;
    stderrPath: string;
  }) {
    mkdirSync(logDirectory, { recursive: true });
    this.stderrPath = stderrPath;
    const isJavaScript = ['.js', '.mjs', '.cjs'].includes(extname(mcpPath));
    this.transport = new StdioClientTransport({
      command: isJavaScript ? process.execPath : mcpPath,
      args: isJavaScript ? [mcpPath] : [],
      stderr: 'pipe',
      env: environmentWithOverrides({
        TRANSPORT: 'stdio',
        ENABLED_LOGGERS: 'fileLogger',
        FILE_LOGGER_DIRECTORY: logDirectory,
        LOG_LEVEL: 'debug',
        DEFAULT_NOTIFICATION_LEVEL: 'debug',
        TABLEAU_DESKTOP_SESSION_ID: String(desktopPid),
        TOOL_PROFILE: 'full',
      }),
    });
    const stderr = this.transport.stderr;
    if (stderr) {
      stderr.on('data', (chunk) => {
        const handle = openSync(this.stderrPath, 'a');
        try {
          writeFileSync(handle, redactSecrets(String(chunk)));
        } finally {
          closeSync(handle);
        }
      });
    }
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<string[]> {
    return (await this.client.listTools()).tools.map(({ name }) => name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return await this.client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]');
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return redactSecrets(value);
  }
}

function parseTextContent(value: unknown): unknown {
  const result = value as {
    content?: Array<{ type?: unknown; text?: unknown }>;
    isError?: unknown;
  };
  if (result?.isError === true) {
    throw new Error(`MCP tool returned an error: ${JSON.stringify(value)}`);
  }
  const text = result?.content?.find((block) => block.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new Error(`MCP tool did not return text content: ${JSON.stringify(value)}`);
  }
  return JSON.parse(text);
}

function validateOpenWorkbook(inventory: unknown, options: SmokeOptions): void {
  const schema = z
    .object({ title: z.string(), location: z.string().nullable().optional() })
    .passthrough();
  const parsed = schema.parse(inventory);
  const titleMatches = parsed.title.includes(options.expectedWorkbookTitle);
  const locationMatches =
    typeof parsed.location === 'string' &&
    basename(parsed.location).toLowerCase() === basename(options.workbookPath).toLowerCase();
  if (!titleMatches && !locationMatches) {
    throw new Error(
      `Wrong workbook is open. Expected title containing "${options.expectedWorkbookTitle}" or ` +
        `location ${options.workbookPath}; got ${JSON.stringify(parsed)}.`,
    );
  }
}

function validateOptimizer(
  result: WorkbookOptimizerResult,
  desktop: DesktopContext,
  options: SmokeOptions,
): OptimizerValidationSummary {
  return validateWorkbookOptimizerResult({
    result,
    manifestRuleIds: desktop.manifestRuleIds,
    expectedRules: options.expectedRules,
  });
}

function snapshotSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function readFromOffset(path: string, offset: number): string {
  if (!existsSync(path)) {
    return '';
  }
  const contents = readFileSync(path);
  const start = contents.length >= offset ? offset : 0;
  return contents.subarray(start).toString('utf8');
}

async function waitFor<T>(
  description: string,
  timeoutMs: number,
  probe: () => T | null | undefined | false | Promise<T | null | undefined | false>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== null && value !== undefined && value !== false) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${String(lastError)}` : ''}`,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function collectDesktopRouteLog({
  desktopLogPath,
  offset,
  destination,
}: {
  desktopLogPath: string;
  offset: number;
  destination: string;
}): Promise<string> {
  const delta = await waitFor('Desktop Workbook Optimizer route log entries', 30_000, () => {
    const candidate = readFromOffset(desktopLogPath, offset);
    try {
      validateDesktopRouteLog(candidate);
      return candidate;
    } catch {
      return null;
    }
  });
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, redactSecrets(delta));
  return delta;
}

function readAllLogs(directory: string): string {
  if (!existsSync(directory)) {
    return '';
  }
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return [readAllLogs(path)];
      }
      return entry.isFile() && entry.name.endsWith('.log') ? [readFileSync(path, 'utf8')] : [];
    })
    .join('\n');
}

async function requireMcpInvocationLog(directory: string): Promise<void> {
  await waitFor('tableau-mcp invocation log', 20_000, () =>
    readAllLogs(directory).includes(workbookOptimizerToolName) ? true : null,
  );
}

async function runDirectScenario(options: SmokeOptions, desktop: DesktopContext): Promise<void> {
  const scenarioDirectory = join(options.outputDirectory, 'direct-mcp');
  const mcpLogDirectory = join(scenarioDirectory, 'mcp-logs');
  const desktopLogOffset = snapshotSize(desktop.desktopLogPath);
  const mcp = new SmokeMcpClient({
    mcpPath: options.mcpPath,
    desktopPid: desktop.instance.pid,
    logDirectory: mcpLogDirectory,
    stderrPath: join(scenarioDirectory, 'mcp.stderr.log'),
  });

  try {
    await mcp.connect();
    const toolNames = await mcp.listTools();
    if (!toolNames.includes(workbookOptimizerToolName)) {
      throw new Error(
        `${workbookOptimizerToolName} was not advertised. Advertised tools: ${toolNames.join(', ')}.`,
      );
    }

    const inventoryResponse = await mcp.callTool('get-workbook-inventory', {
      session: String(desktop.instance.pid),
    });
    const inventory = parseTextContent(inventoryResponse);
    validateOpenWorkbook(inventory, options);

    const optimizerResponse = await mcp.callTool(workbookOptimizerToolName, {
      session: String(desktop.instance.pid),
    });
    if (
      optimizerResponse &&
      typeof optimizerResponse === 'object' &&
      (optimizerResponse as { isError?: unknown }).isError === true
    ) {
      throw new Error(`Workbook Optimizer MCP call failed: ${JSON.stringify(optimizerResponse)}`);
    }
    const optimizerResult = extractWorkbookOptimizerResult(optimizerResponse);
    if (!optimizerResult) {
      throw new Error(
        `Could not parse Workbook Optimizer MCP result: ${JSON.stringify(optimizerResponse)}`,
      );
    }
    const validation = validateOptimizer(optimizerResult, desktop, options);
    await requireMcpInvocationLog(mcpLogDirectory);
    await collectDesktopRouteLog({
      desktopLogPath: desktop.desktopLogPath,
      offset: desktopLogOffset,
      destination: join(scenarioDirectory, 'desktop.log.delta.txt'),
    });
    writeJson(join(scenarioDirectory, 'receipt.json'), {
      status: 'PASS',
      advertisedTool: workbookOptimizerToolName,
      inventory,
      validation,
      optimizerResult,
    });
    console.log(`PASS direct MCP -> ${scenarioDirectory}`);
  } finally {
    await mcp.close().catch(() => undefined);
  }
}

function loadDotEnv(path: string, env: Record<string, string>): void {
  if (!existsSync(path)) {
    return;
  }
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }
    const separator = line.indexOf('=');
    const key = line
      .slice(0, separator)
      .trim()
      .replace(/^export\s+/, '');
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
    if (key && !(key in env)) {
      env[key] = value;
    }
  }
}

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a loopback port.'));
        return;
      }
      const port = address.port;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

function defaultAgentExecutable(agentRoot: string): string | undefined {
  const suffix =
    process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'tab-agent-south-macos-arm64'
        : 'tab-agent-south-macos-x64'
      : process.platform === 'win32'
        ? 'tab-agent-south-windows.exe'
        : 'tab-agent-south-linux';
  const candidate = resolve(agentRoot, 'dist', suffix);
  return existsSync(candidate) ? candidate : undefined;
}

type SpawnedAgent = {
  child: ChildProcess;
  wsUrl: string;
  healthUrl: string;
  agentLogDirectory: string;
};

async function spawnAgentBackend(
  options: SmokeOptions,
  desktop: DesktopContext,
  scenarioDirectory: string,
): Promise<SpawnedAgent> {
  const wsPort = await freePort();
  let healthPort = await freePort();
  while (healthPort === wsPort) {
    healthPort = await freePort();
  }
  const agentDataDirectory = join(scenarioDirectory, 'agent-data');
  const agentLogDirectory = join(agentDataDirectory, 'logs');
  mkdirSync(agentLogDirectory, { recursive: true });

  const executable = options.agentExecutable ?? defaultAgentExecutable(options.agentRoot);
  const flags = [
    `--ws-port=${wsPort}`,
    `--health-port=${healthPort}`,
    `--mcp-path=${options.mcpPath}`,
    `--agent-data-dir=${agentDataDirectory}`,
    `--log-dir=${dirname(desktop.desktopLogPath)}`,
    '--log-level=DEBUG',
    '--dev',
  ];
  const command = executable ?? 'uv';
  const args = executable ? flags : ['run', 'tab-agent-south', ...flags];
  const env = environmentWithOverrides({
    TABLEAU_DESKTOP_SESSION_ID: String(desktop.instance.pid),
    TAB_AGENT_WS_TOKEN: '',
    TAB_AGENT_ALLOWED_ORIGINS: '',
    TAB_AGENT_ASK_LEDGER_PATH: join(agentLogDirectory, 'ask-ledger.jsonl'),
  });
  loadDotEnv(join(options.agentRoot, '.dev.env'), env);

  const logPath = join(scenarioDirectory, 'agent-process.log');
  const logHandle = openSync(logPath, 'a');
  const child: ChildProcess = spawn(command, args, {
    cwd: options.agentRoot,
    env: env as typeof process.env,
    stdio: ['ignore', logHandle, logHandle] as const,
  });
  closeSync(logHandle);
  child.once('error', (error) => {
    appendJsonLine(join(scenarioDirectory, 'harness-events.jsonl'), {
      timestamp: new Date().toISOString(),
      event: 'agent-process-error',
      error: String(error),
    });
  });

  const healthUrl = `http://127.0.0.1:${healthPort}/healthz`;
  try {
    await waitFor('spawned tab-agent-south health', 120_000, async () => {
      if (child.exitCode !== null) {
        throw new Error(`tab-agent-south exited ${child.exitCode}. See ${logPath}.`);
      }
      try {
        const response = await fetch(healthUrl);
        if (!response.ok) {
          return null;
        }
        const health = (await response.json()) as {
          status?: unknown;
          details?: { desktopMcp?: unknown };
        };
        return health.status === 'ok' && health.details?.desktopMcp === 'registered'
          ? health
          : null;
      } catch {
        return null;
      }
    });
  } catch (error) {
    await stopAgentBackend(child);
    throw error;
  }

  return {
    child,
    wsUrl: `ws://127.0.0.1:${wsPort}`,
    healthUrl,
    agentLogDirectory,
  };
}

async function stopAgentBackend(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(10_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function openWebSocket(url: string, token?: string): Promise<WebSocket> {
  const socket = new WebSocket(url, token ? [token] : undefined);
  return await new Promise((resolveSocket, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out connecting to ${url}.`));
    }, 20_000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolveSocket(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error(`WebSocket connection failed: ${url}.`));
      },
      { once: true },
    );
  });
}

async function runAgentTurn({
  wsUrl,
  token,
  prompt,
  timeoutMs,
  receiptPath,
}: {
  wsUrl: string;
  token?: string;
  prompt: string;
  timeoutMs: number;
  receiptPath: string;
}): Promise<{ chatId: string; events: Array<Record<string, unknown>> }> {
  const chatId = randomUUID();
  const socket = await openWebSocket(wsUrl, token);
  const events: Array<Record<string, unknown>> = [];
  let settled = false;

  try {
    return await new Promise((resolveTurn, reject) => {
      const fail = (error: Error): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      };
      const timeout = setTimeout(() => {
        fail(new Error(`Agent turn ${chatId} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      socket.addEventListener('message', (message) => {
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(String(message.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        events.push(event);
        appendJsonLine(receiptPath, { timestamp: new Date().toISOString(), ...event });
        if (event.chatId !== chatId) {
          return;
        }
        if (event.type === 'agent_error' && !settled) {
          fail(new Error(`Agent returned agent_error: ${JSON.stringify(event)}`));
        } else if (event.type === 'result' && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolveTurn({ chatId, events });
        }
      });
      socket.addEventListener('error', () => {
        fail(new Error(`Agent WebSocket errored during chat ${chatId}.`));
      });
      socket.addEventListener('close', () => {
        fail(new Error(`Agent WebSocket closed before chat ${chatId} completed.`));
      });
      try {
        socket.send(JSON.stringify({ type: 'subscribe', chatId, ephemeral: true }));
        socket.send(JSON.stringify({ type: 'chat', chatId, content: prompt }));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  } finally {
    socket.close();
  }
}

function validateAgentEvents(
  events: Array<Record<string, unknown>>,
  desktop: DesktopContext,
  options: SmokeOptions,
): { optimizerResult: WorkbookOptimizerResult; validation: OptimizerValidationSummary } {
  const optimizerUse = events.find(
    (event) => event.type === 'tool_use' && isWorkbookOptimizerToolName(event.toolName),
  );
  if (!optimizerUse) {
    const tools = events
      .filter((event) => event.type === 'tool_use')
      .map((event) => String(event.toolName));
    throw new Error(
      `Agent did not call ${workbookOptimizerToolName}. Tool calls: ${tools.join(', ')}.`,
    );
  }
  const legacyAnalyzerCall = events.find(
    (event) =>
      event.type === 'tool_use' &&
      String(event.toolName).endsWith('__execute-tableau-command') &&
      JSON.stringify(event.toolInput).includes('get-workbook-analyzer-data'),
  );
  if (legacyAnalyzerCall) {
    throw new Error(
      'Agent used legacy get-workbook-analyzer-data instead of run-workbook-optimizer.',
    );
  }

  const toolId = optimizerUse.toolId;
  const toolResultEvent = events.find(
    (event) => event.type === 'tool_result' && event.toolUseId === toolId,
  );
  if (!toolResultEvent || toolResultEvent.isError === true) {
    throw new Error(
      `Optimizer tool result is missing or failed: ${JSON.stringify(toolResultEvent)}`,
    );
  }
  const optimizerResult = extractWorkbookOptimizerResult(toolResultEvent);
  if (!optimizerResult) {
    throw new Error(
      `Could not parse optimizer result from agent event: ${JSON.stringify(toolResultEvent)}`,
    );
  }
  const terminal = findLast(events, (event) => event.type === 'result');
  if (terminal?.success !== true) {
    throw new Error(`Agent turn did not finish successfully: ${JSON.stringify(terminal)}`);
  }
  return { optimizerResult, validation: validateOptimizer(optimizerResult, desktop, options) };
}

async function validateAskLedger(path: string, chatId: string): Promise<Record<string, unknown>> {
  return await waitFor('tab-agent-south ask-ledger receipt', 30_000, () => {
    if (!existsSync(path)) {
      return null;
    }
    const records = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const record = records.find((candidate) => candidate.chat_id === chatId);
    const calls = record?.tool_calls;
    if (
      !record ||
      !Array.isArray(calls) ||
      !calls.some(
        (call) =>
          call &&
          typeof call === 'object' &&
          isWorkbookOptimizerToolName((call as Record<string, unknown>).name),
      )
    ) {
      return null;
    }
    return record;
  });
}

async function runBackendScenario(options: SmokeOptions, desktop: DesktopContext): Promise<void> {
  const scenarioDirectory = join(options.outputDirectory, 'agent-backend');
  mkdirSync(scenarioDirectory, { recursive: true });
  const desktopLogOffset = snapshotSize(desktop.desktopLogPath);
  let spawned: SpawnedAgent | undefined;
  let wsUrl = options.agentWsUrl;
  let agentLogDirectory: string | undefined;

  try {
    if (!wsUrl) {
      spawned = await spawnAgentBackend(options, desktop, scenarioDirectory);
      wsUrl = spawned.wsUrl;
      agentLogDirectory = spawned.agentLogDirectory;
    }
    const marker = `WORKBOOK_OPTIMIZER_SMOKE_${randomUUID()}_BACKEND`;
    const prompt =
      `[${marker}] Run Workbook Optimizer on the currently open workbook using the ` +
      `${workbookOptimizerToolName} tool. Do not use execute-tableau-command or ` +
      'get-workbook-analyzer-data. Summarize the failed and needs-review rule IDs.';
    const turn = await runAgentTurn({
      wsUrl,
      token: options.agentWsToken,
      prompt,
      timeoutMs: options.timeoutMs,
      receiptPath: join(scenarioDirectory, 'websocket-events.jsonl'),
    });
    const validated = validateAgentEvents(turn.events, desktop, options);

    let ledgerRecord: Record<string, unknown> | undefined;
    if (agentLogDirectory) {
      ledgerRecord = await validateAskLedger(
        join(agentLogDirectory, 'ask-ledger.jsonl'),
        turn.chatId,
      );
      await requireMcpInvocationLog(agentLogDirectory);
    }
    await collectDesktopRouteLog({
      desktopLogPath: desktop.desktopLogPath,
      offset: desktopLogOffset,
      destination: join(scenarioDirectory, 'desktop.log.delta.txt'),
    });
    writeJson(join(scenarioDirectory, 'receipt.json'), {
      status: 'PASS',
      chatId: turn.chatId,
      marker,
      wsUrl,
      spawnedBackend: Boolean(spawned),
      agentHealthUrl: spawned?.healthUrl,
      validation: validated.validation,
      optimizerResult: validated.optimizerResult,
      askLedgerRecord: ledgerRecord,
    });
    console.log(`PASS agent backend/executable -> ${scenarioDirectory}`);
  } finally {
    if (spawned) {
      await stopAgentBackend(spawned.child);
    }
  }
}

class CdpClient {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(message: Record<string, unknown>) => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (pending) {
          clearTimeout(pending.timer);
        }
        if (message.error) {
          pending?.reject(new Error(`CDP error: ${JSON.stringify(message.error)}`));
        } else {
          pending?.resolve(message);
        }
        return;
      }
      for (const listener of this.listeners) {
        listener(message);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('CDP WebSocket closed before the command completed.'));
      }
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    return new CdpClient(await openWebSocket(url));
  }

  onEvent(listener: (message: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    const response = new Promise<Record<string, unknown>>((resolveResponse, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}.`));
      }, 20_000);
      this.pending.set(id, { resolve: resolveResponse, reject, timer });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return await response;
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    const result = response.result as
      | { exceptionDetails?: unknown; result?: { value?: unknown; description?: unknown } }
      | undefined;
    if (result?.exceptionDetails) {
      throw new Error(`CDP evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    }
    return result?.result?.value as T;
  }

  async screenshot(path: string): Promise<void> {
    const response = await this.send('Page.captureScreenshot', { format: 'png' });
    const result = response.result as { data?: unknown } | undefined;
    if (typeof result?.data !== 'string') {
      throw new Error('CDP screenshot did not return PNG data.');
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(result.data, 'base64'));
  }

  close(): void {
    this.socket.close();
  }
}

async function listCdpTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) {
    throw new Error(`CDP target discovery returned HTTP ${response.status}.`);
  }
  const targets = (await response.json()) as Array<Partial<CdpTarget>>;
  return targets.filter(
    (target): target is CdpTarget =>
      target.type === 'page' &&
      typeof target.id === 'string' &&
      typeof target.title === 'string' &&
      typeof target.url === 'string' &&
      typeof target.webSocketDebuggerUrl === 'string',
  );
}

async function probeAgentUiTarget(
  port: number,
): Promise<{ target: CdpTarget; client: CdpClient; probe: CdpProbe } | null> {
  const targets = await listCdpTargets(port);
  for (const target of targets) {
    const client = await CdpClient.connect(target.webSocketDebuggerUrl);
    try {
      await client.send('Runtime.enable');
      const probe = await client.evaluate<CdpProbe>(`(() => ({
        hasComposer: Boolean(document.querySelector(${JSON.stringify(composerSelector)})),
        hasWelcomeButton: Boolean(document.querySelector(${JSON.stringify(welcomeButtonSelector)})),
        title: document.title,
        url: location.href,
        visibility: document.visibilityState
      }))()`);
      if (probe?.hasComposer || probe?.hasWelcomeButton) {
        return { target, client, probe };
      }
    } catch {
      // A non-agent WebEngine target may not expose a usable execution context.
    }
    client.close();
  }
  return null;
}

async function openAgentPane(desktop: DesktopContext): Promise<void> {
  const result = await desktop.client.postJsonEnvelope(EXTERNAL_API_ROUTES.invokeCommand, {
    namespace: 'tabui',
    command: 'toggle-analytics-assistant-side-pane-from-desktop',
    parameters: {},
  });
  if (result.isErr()) {
    throw new Error(`Could not open Tableau Agent pane: ${JSON.stringify(result.error)}`);
  }
}

function cdpFrame(message: Record<string, unknown>): NetworkFrame | null {
  if (
    message.method !== 'Network.webSocketFrameSent' &&
    message.method !== 'Network.webSocketFrameReceived'
  ) {
    return null;
  }
  const params = message.params as
    | { response?: { opcode?: unknown; payloadData?: unknown } }
    | undefined;
  if (params?.response?.opcode !== 1 || typeof params.response.payloadData !== 'string') {
    return null;
  }
  return {
    timestamp: new Date().toISOString(),
    direction: message.method.endsWith('Sent') ? 'sent' : 'received',
    payload: params.response.payloadData,
  };
}

function parseNetworkEvent(frame: NetworkFrame): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(frame.payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function prepareVisibleAgentUi(
  options: SmokeOptions,
  desktop: DesktopContext,
): Promise<{ target: CdpTarget; client: CdpClient; probe: CdpProbe }> {
  let located: { target: CdpTarget; client: CdpClient; probe: CdpProbe } | null = null;
  try {
    located = await probeAgentUiTarget(options.cdpPort);
  } catch {
    // The toggle below can create the first WebEngine target, but it cannot create a CDP listener.
  }

  if (!located || located.probe.visibility !== 'visible') {
    located?.client.close();
    await openAgentPane(desktop);
    located = await waitFor('visible Tableau Agent WebEngine target', 45_000, async () => {
      const candidate = await probeAgentUiTarget(options.cdpPort);
      if (!candidate) {
        return null;
      }
      if (candidate.probe.visibility !== 'visible') {
        candidate.client.close();
        return null;
      }
      return candidate;
    });
  }
  return located;
}

async function ensureComposer(client: CdpClient): Promise<void> {
  const welcomeClicked = await client.evaluate<boolean>(`(() => {
    const button = document.querySelector(${JSON.stringify(welcomeButtonSelector)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (welcomeClicked) {
    await delay(5_500);
  }

  await waitFor('Tableau Agent composer', 30_000, async () =>
    (await client.evaluate<boolean>(
      `Boolean(document.querySelector(${JSON.stringify(composerSelector)}))`,
    ))
      ? true
      : null,
  );
}

async function startFreshUiChat(client: CdpClient): Promise<boolean> {
  return await client.evaluate<boolean>(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const menu = document.querySelector('[data-tb-test-id="header-app-menu-button-Button"]');
    if (!menu) return false;
    menu.click();
    await sleep(500);
    const conversations = document.querySelector('[data-tb-test-id="header-app-menu-conversations-MenuItem"]');
    if (!conversations) return false;
    conversations.click();
    await sleep(500);
    const fresh = document.querySelector('[data-tb-test-id="conversations-new-chat-Button"]');
    if (!fresh) return false;
    fresh.click();
    return true;
  })()`);
}

async function submitUiPrompt(client: CdpClient, prompt: string): Promise<void> {
  const result = await client.evaluate<string>(`(async () => {
    const composer = document.querySelector(${JSON.stringify(composerSelector)});
    if (!composer) return 'COMPOSER_NOT_FOUND';
    if (composer.getAttribute('contenteditable') !== 'true') return 'COMPOSER_DISABLED';
    composer.focus();
    composer.textContent = ${JSON.stringify(prompt)};
    composer.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: ${JSON.stringify(prompt)}
    }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const send = document.querySelector(${JSON.stringify(sendButtonSelector)});
    if (!send) return 'SEND_NOT_FOUND';
    if (send.disabled) return 'SEND_DISABLED';
    send.click();
    return 'SUBMITTED';
  })()`);
  if (result !== 'SUBMITTED') {
    throw new Error(`Could not submit Tableau Agent UI prompt: ${result}.`);
  }
}

async function runUiScenario(options: SmokeOptions, desktop: DesktopContext): Promise<void> {
  const scenarioDirectory = join(options.outputDirectory, 'tableau-agent-ui');
  mkdirSync(scenarioDirectory, { recursive: true });
  const desktopLogOffset = snapshotSize(desktop.desktopLogPath);
  const located = await prepareVisibleAgentUi(options, desktop);
  const { client, target } = located;
  const frames: NetworkFrame[] = [];
  const consoleErrors: Array<Record<string, unknown>> = [];
  const stopListening = client.onEvent((message) => {
    const frame = cdpFrame(message);
    if (frame) {
      frames.push(frame);
    } else if (
      message.method === 'Runtime.exceptionThrown' ||
      (message.method === 'Runtime.consoleAPICalled' &&
        (message.params as { type?: unknown } | undefined)?.type === 'error')
    ) {
      consoleErrors.push(message);
    }
  });

  try {
    await client.send('Network.enable');
    await client.send('Page.enable');
    await client.send('Page.bringToFront');
    await ensureComposer(client);
    const freshChat = await startFreshUiChat(client);
    if (!freshChat) {
      throw new Error(
        'Could not create an isolated Tableau Agent chat; refusing to reuse an existing conversation.',
      );
    }
    await ensureComposer(client);
    await client.screenshot(join(scenarioDirectory, 'before-prompt.png'));

    const marker = `WORKBOOK_OPTIMIZER_SMOKE_${randomUUID()}_UI`;
    const prompt =
      `[${marker}] Run Workbook Optimizer on this workbook using the ` +
      `${workbookOptimizerToolName} tool. Do not use execute-tableau-command or ` +
      'get-workbook-analyzer-data. Summarize the failed and needs-review rule IDs.';
    await submitUiPrompt(client, prompt);

    const sentChat = await waitFor('Tableau Agent UI chat WebSocket frame', 30_000, () => {
      for (const frame of frames) {
        if (frame.direction !== 'sent') continue;
        const event = parseNetworkEvent(frame);
        if (
          event?.type === 'chat' &&
          event.content === prompt &&
          typeof event.chatId === 'string'
        ) {
          return event;
        }
      }
      return null;
    });
    const chatId = String(sentChat.chatId);
    await waitFor('Tableau Agent UI terminal result frame', options.timeoutMs, () => {
      const event = findLast(
        frames.filter(({ direction }) => direction === 'received').map(parseNetworkEvent),
        (candidate) => candidate?.type === 'result' && candidate.chatId === chatId,
      );
      return event ?? null;
    });

    const receivedEvents = frames
      .filter(({ direction }) => direction === 'received')
      .map(parseNetworkEvent)
      .filter(
        (event): event is Record<string, unknown> => event !== null && event.chatId === chatId,
      );
    for (const frame of frames.filter(
      (candidate) => parseNetworkEvent(candidate)?.chatId === chatId,
    )) {
      appendJsonLine(join(scenarioDirectory, 'websocket-frames.jsonl'), frame);
    }
    const validated = validateAgentEvents(receivedEvents, desktop, options);
    const promptVisible = await client.evaluate<boolean>(
      `document.body.innerText.includes(${JSON.stringify(marker)})`,
    );
    if (!promptVisible) {
      throw new Error('The submitted smoke marker was not visible in Tableau Agent chat history.');
    }
    await client.screenshot(join(scenarioDirectory, 'after-result.png'));
    await collectDesktopRouteLog({
      desktopLogPath: desktop.desktopLogPath,
      offset: desktopLogOffset,
      destination: join(scenarioDirectory, 'desktop.log.delta.txt'),
    });
    writeJson(join(scenarioDirectory, 'console-errors.json'), consoleErrors);
    writeJson(join(scenarioDirectory, 'receipt.json'), {
      status: 'PASS',
      marker,
      chatId,
      target: { id: target.id, title: target.title, url: sanitizeUrl(target.url) },
      freshChat,
      promptVisible,
      validation: validated.validation,
      optimizerResult: validated.optimizerResult,
      consoleErrorCount: consoleErrors.length,
      screenshots: ['before-prompt.png', 'after-result.png'],
    });
    console.log(`PASS visible Tableau Agent UI -> ${scenarioDirectory}`);
  } finally {
    stopListening();
    client.close();
  }
}

function findLast<T>(values: T[], predicate: (value: T) => boolean): T | undefined {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index];
    if (predicate(value)) {
      return value;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  const manifestRuleIds = staticPreflight(options);
  if (!options.run) {
    console.log(
      'CHECK PASS: smoke inputs are present. No live process, API, MCP, agent, or UI was invoked.',
    );
    console.log(JSON.stringify({ ...safeOptions(options), manifestRuleIds }, null, 2));
    console.log('\nRe-run with --run only after the Desktop build and product setup are ready.');
    return;
  }

  mkdirSync(options.outputDirectory, { recursive: true });
  writeJson(join(options.outputDirectory, 'requested-run.json'), safeOptions(options));
  try {
    const desktop = await prepareDesktop(options, manifestRuleIds);

    if (options.scenarios.has('direct')) {
      await runDirectScenario(options, desktop);
    }
    if (options.scenarios.has('backend')) {
      await runBackendScenario(options, desktop);
    }
    if (options.scenarios.has('ui')) {
      await runUiScenario(options, desktop);
    }

    writeJson(join(options.outputDirectory, 'summary.json'), {
      status: 'PASS',
      completedAt: new Date().toISOString(),
      scenarios: [...options.scenarios],
      receipts: {
        direct: options.scenarios.has('direct') ? 'direct-mcp/receipt.json' : undefined,
        backend: options.scenarios.has('backend') ? 'agent-backend/receipt.json' : undefined,
        ui: options.scenarios.has('ui') ? 'tableau-agent-ui/receipt.json' : undefined,
      },
    });
    console.log(
      `PASS all requested Workbook Optimizer smoke scenarios -> ${options.outputDirectory}`,
    );
  } catch (error) {
    writeJson(join(options.outputDirectory, 'failure.json'), {
      status: 'FAIL',
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(
    `FAIL Workbook Optimizer smoke: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
