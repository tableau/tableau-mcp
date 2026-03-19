#!/usr/bin/env npx tsx
/**
 * Validates that tableau-mcp accepts passthrough-authenticated MCP requests.
 *
 * Default mode (handshake) validates connectivity. Works in both sessioned and stateless modes.
 *
 * Staged modes (discover and beyond) require sessioned mode (DISABLE_SESSION_MANAGEMENT=false).
 * In stateless mode, the MCP transport creates a fresh instance per request; only initialize
 * succeeds. tools/list and tools/call require a prior initialize on the same transport.
 *
 * Staged modes:
 * - handshake: initialize only
 * - discover: initialize + tools/list
 * - search: discover + search-content
 * - datasource: discover + optional search-content + list-datasources
 * - metadata: discover + optional prior stages + get-datasource-metadata
 * - query: discover + optional prior stages + query-datasource
 * - full: discover + search-content + list-datasources + get-datasource-metadata + query-datasource
 *
 * Required env:
 * - TABLEAU_SESSION_TOKEN
 *
 * Optional env:
 * - MCP_URL=http://127.0.0.1:3927/tableau-mcp
 * - VALIDATE_STAGE=handshake|discover|search|datasource|metadata|query|full
 * - SEARCH_TERMS=<text>
 * - SEARCH_LIMIT=<number>
 * - SEARCH_CONTENT_ARGS_JSON=<json object>
 * - DATASOURCE_FILTER=<field:operator:value expression>
 * - LIST_DATASOURCES_ARGS_JSON=<json object>
 * - DATASOURCE_LUID=<datasource luid>
 * - QUERY_DATASOURCE_ARGS_JSON=<json object>
 *
 * CLI flags override env:
 * - --stage=<stage>
 * - --search-terms=<text>
 * - --search-limit=<number>
 * - --search-args-json='<json>'
 * - --datasource-filter=<filter>
 * - --list-args-json='<json>'
 * - --datasource-luid=<luid>
 * - --query-args-json='<json>'
 * - --mcp-url=<url>
 * - --help
 */

type JsonObject = Record<string, unknown>;
type Stage = 'handshake' | 'discover' | 'search' | 'datasource' | 'metadata' | 'query' | 'full';

type McpSuccessResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: {
    tools?: Array<{ name?: string }>;
    content?: Array<{ type?: string; text?: string }>;
  };
  error?: {
    code?: number;
    message?: string;
  };
};

const HELP_TEXT = `
Usage:
  TABLEAU_SESSION_TOKEN=<token> npm run validate:slack-mcp

Examples:
  TABLEAU_SESSION_TOKEN=<token> VALIDATE_STAGE=discover npm run validate:slack-mcp
  TABLEAU_SESSION_TOKEN=<token> VALIDATE_STAGE=search SEARCH_TERMS="sales" npm run validate:slack-mcp
  TABLEAU_SESSION_TOKEN=<token> VALIDATE_STAGE=datasource DATASOURCE_FILTER="name:eq:Sales" npm run validate:slack-mcp
  TABLEAU_SESSION_TOKEN=<token> VALIDATE_STAGE=metadata DATASOURCE_LUID=<luid> npm run validate:slack-mcp
  TABLEAU_SESSION_TOKEN=<token> VALIDATE_STAGE=query QUERY_DATASOURCE_ARGS_JSON='{"datasourceLuid":"<luid>","query":{"fields":[{"fieldCaption":"Category"},{"fieldCaption":"Sales","function":"SUM"}]}}' npm run validate:slack-mcp

Notes:
  - handshake works in both sessioned and stateless modes; discover and beyond require sessioned mode (DISABLE_SESSION_MANAGEMENT=false).
  - query-datasource needs repo-valid query JSON; this script does not invent one.
  - list-datasources uses a raw filter string unless LIST_DATASOURCES_ARGS_JSON is provided.
  - later stages can reuse a datasource inferred from earlier results when there is exactly one match.
`.trim();

const stageOrder: Stage[] = [
  'handshake',
  'discover',
  'search',
  'datasource',
  'metadata',
  'query',
  'full',
];

const requiredJoeFlowTools = [
  'search-content',
  'list-datasources',
  'get-datasource-metadata',
  'query-datasource',
];

const cli = parseCliArgs(process.argv.slice(2));

if (cli.help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const token = process.env.TABLEAU_SESSION_TOKEN;
const baseUrl = cli.mcpUrl || process.env.MCP_URL || 'http://127.0.0.1:3927/tableau-mcp';
const stage = getStage(cli.stage || process.env.VALIDATE_STAGE || 'handshake');

if (!token) {
  fail('TABLEAU_SESSION_TOKEN is required.');
}

const searchArgs = getSearchArgs();
const listDatasourceArgs = getListDatasourceArgs();
const explicitDatasourceLuid = cli.datasourceLuid || process.env.DATASOURCE_LUID || '';
const queryDatasourceArgs = getOptionalJsonObject(
  cli.queryArgsJson || process.env.QUERY_DATASOURCE_ARGS_JSON,
  'QUERY_DATASOURCE_ARGS_JSON',
);

const state: {
  sessionId: string;
  searchResults?: unknown[];
  datasourceCandidates: Array<{ luid: string; name?: string }>;
  selectedDatasourceLuid?: string;
  metadata?: unknown;
  queryResult?: unknown;
} = {
  sessionId: '',
  datasourceCandidates: [],
};

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'validate-slack-mcp', version: '2.0' },
  },
};

async function post(body: object, sessionId?: string): Promise<{
  status: number;
  data: McpSuccessResponse;
  sessionId: string;
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'x-tableau-auth': token!,
  };

  if (sessionId) {
    headers['mcp-session-id'] = sessionId;
  }

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const contentType = res.headers.get('content-type') ?? '';
  const rawBody = await res.text();
  const method = typeof body === 'object' && body !== null && 'method' in body ? (body as { method?: string }).method : 'unknown';

  if (process.env.VALIDATE_DEBUG || method === 'tools/list') {
    console.error(`[DEBUG] ${method} -> Content-Type: ${contentType}`);
    console.error(`[DEBUG] ${method} -> body (first 800 chars):\n${rawBody.slice(0, 800)}`);
  }

  let data: McpSuccessResponse;
  if (contentType.includes('text/event-stream')) {
    const parsed = parseSseBody(rawBody, typeof body === 'object' && body !== null && 'id' in body ? (body as { id?: number }).id : undefined);
    data = parsed ?? ({} as McpSuccessResponse);
  } else {
    try {
      data = (rawBody ? JSON.parse(rawBody) : {}) as McpSuccessResponse;
    } catch {
      data = {} as McpSuccessResponse;
    }
  }

  return {
    status: res.status,
    data,
    sessionId: res.headers.get('mcp-session-id') || sessionId || '',
  };
}

function parseSseBody(text: string, expectedId?: number): McpSuccessResponse | undefined {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6);
      if (jsonStr === '[DONE]' || jsonStr.trim() === '') continue;
      try {
        const parsed = JSON.parse(jsonStr) as McpSuccessResponse;
        if (expectedId === undefined || parsed.id === expectedId) {
          return parsed;
        }
      } catch {
        /* skip malformed data lines */
      }
    }
  }
  return undefined;
}

async function callTool(name: string, args: JsonObject, id: number): Promise<unknown> {
  printStep(`tools/call -> ${name}`);
  const response = await post(
    {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    },
    state.sessionId,
  );

  ensureOk(response, `${name} failed`);

  const content = response.data.result?.content ?? [];
  const textPart = content.find((part) => part.type === 'text')?.text ?? '';
  const parsed = parseJsonIfPossible(textPart);

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'requestId' in parsed &&
    'errorType' in parsed
  ) {
    fail(`${name} returned validation error: ${textPart}`);
  }

  console.log(`  success: ${name}`);
  return parsed;
}

function ensureOk(
  response: { status: number; data: McpSuccessResponse; sessionId: string },
  context: string,
): void {
  if (response.status !== 200) {
    fail(`${context}: HTTP ${response.status} ${formatError(response.data)}`);
  }

  if (response.data.error) {
    fail(`${context}: ${formatError(response.data)}`);
  }

  if (!state.sessionId && response.sessionId) {
    state.sessionId = response.sessionId;
  }
}

function printStep(step: string): void {
  console.log(`\n== ${step} ==`);
}

function parseJsonIfPossible(value: string): unknown {
  if (!value) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatError(data: McpSuccessResponse): string {
  if (data.error) {
    return `${data.error.code ?? 'unknown'} ${data.error.message ?? 'Unknown error'}`;
  }

  const text = data.result?.content?.find((part) => part.type === 'text')?.text;
  return text || 'Unknown error';
}

function getStage(value: string): Stage {
  if (stageOrder.includes(value as Stage)) {
    return value as Stage;
  }

  fail(`Unknown VALIDATE_STAGE "${value}". Expected one of: ${stageOrder.join(', ')}`);
}

function hasReached(target: Exclude<Stage, 'full'>): boolean {
  if (stage === 'full') {
    return true;
  }

  return stageOrder.indexOf(stage) >= stageOrder.indexOf(target);
}

function shouldRunSearchStage(): boolean {
  return stage === 'search' || stage === 'full' || (!!searchArgs && hasReached('datasource'));
}

function shouldRunDatasourceStage(): boolean {
  return (
    stage === 'datasource' || stage === 'full' || (!!listDatasourceArgs && hasReached('metadata'))
  );
}

function shouldRunMetadataStage(): boolean {
  return stage === 'metadata' || stage === 'full';
}

function getOptionalJsonObject(value: string | undefined, label: string): JsonObject | undefined {
  if (!value) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    fail(`${label} must be valid JSON: ${String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} must be a JSON object.`);
  }

  return parsed as JsonObject;
}

function getSearchArgs(): JsonObject | undefined {
  const jsonArgs = getOptionalJsonObject(
    cli.searchArgsJson || process.env.SEARCH_CONTENT_ARGS_JSON,
    'SEARCH_CONTENT_ARGS_JSON',
  );
  if (jsonArgs) {
    return jsonArgs;
  }

  const terms = cli.searchTerms || process.env.SEARCH_TERMS;
  if (!terms) {
    return;
  }

  const args: JsonObject = { terms };
  const searchLimit = cli.searchLimit || process.env.SEARCH_LIMIT;
  if (searchLimit) {
    const parsedLimit = Number(searchLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      fail('SEARCH_LIMIT must be a positive integer.');
    }
    args.limit = parsedLimit;
  }

  return args;
}

function getListDatasourceArgs(): JsonObject | undefined {
  const jsonArgs = getOptionalJsonObject(
    cli.listArgsJson || process.env.LIST_DATASOURCES_ARGS_JSON,
    'LIST_DATASOURCES_ARGS_JSON',
  );
  if (jsonArgs) {
    return jsonArgs;
  }

  const filter = cli.datasourceFilter || process.env.DATASOURCE_FILTER;
  if (!filter) {
    return;
  }

  return { filter };
}

function parseCliArgs(args: string[]): {
  help?: boolean;
  stage?: string;
  mcpUrl?: string;
  searchTerms?: string;
  searchLimit?: string;
  searchArgsJson?: string;
  datasourceFilter?: string;
  listArgsJson?: string;
  datasourceLuid?: string;
  queryArgsJson?: string;
} {
  const parsed: Record<string, string | boolean> = {};

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      fail(`Unknown argument "${arg}". Use --help for usage.`);
    }

    const [key, ...rest] = arg.slice(2).split('=');
    if (!key || rest.length === 0) {
      fail(`Argument "${arg}" must use --name=value format.`);
    }

    parsed[key] = rest.join('=');
  }

  return {
    help: parsed.help === true,
    stage: getStringArg(parsed, 'stage'),
    mcpUrl: getStringArg(parsed, 'mcp-url'),
    searchTerms: getStringArg(parsed, 'search-terms'),
    searchLimit: getStringArg(parsed, 'search-limit'),
    searchArgsJson: getStringArg(parsed, 'search-args-json'),
    datasourceFilter: getStringArg(parsed, 'datasource-filter'),
    listArgsJson: getStringArg(parsed, 'list-args-json'),
    datasourceLuid: getStringArg(parsed, 'datasource-luid'),
    queryArgsJson: getStringArg(parsed, 'query-args-json'),
  };
}

function getStringArg(values: Record<string, string | boolean>, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

function extractDatasourceCandidatesFromSearch(
  value: unknown,
): Array<{ luid: string; name?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const candidates: Array<{ luid: string; name?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    if (typeof record.luid === 'string' && record.type === 'datasource') {
      candidates.push({
        luid: record.luid,
        name: typeof record.title === 'string' ? record.title : undefined,
      });
    }
  }

  return candidates;
}

function extractDatasourceCandidatesFromList(
  value: unknown,
): Array<{ luid: string; name?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const candidates: Array<{ luid: string; name?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Record<string, unknown>;
    if (
      typeof record.id === 'string' &&
      typeof record.name === 'string' &&
      'project' in record &&
      'tags' in record
    ) {
      candidates.push({
        luid: record.id,
        name: typeof record.name === 'string' ? record.name : undefined,
      });
    }
  }

  return candidates;
}

function selectDatasourceLuid(): string | undefined {
  if (explicitDatasourceLuid) {
    return explicitDatasourceLuid;
  }

  const unique = new Map<string, { luid: string; name?: string }>();
  for (const candidate of state.datasourceCandidates) {
    unique.set(candidate.luid, candidate);
  }

  if (unique.size === 1) {
    const only = Array.from(unique.values())[0];
    console.log(`  inferred datasourceLuid: ${only.luid}${only.name ? ` (${only.name})` : ''}`);
    return only.luid;
  }

  if (unique.size > 1) {
    const summary = Array.from(unique.values())
      .map((candidate) => `${candidate.luid}${candidate.name ? ` (${candidate.name})` : ''}`)
      .join(', ');
    fail(
      `Could not infer a single datasourceLuid. Provide DATASOURCE_LUID explicitly. Candidates: ${summary}`,
    );
  }

  return;
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) {
    fail(message);
  }
  return value;
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

(async () => {
  console.log(`Validator stage: ${stage}`);
  console.log(`MCP URL: ${baseUrl}`);
  if (process.env.VALIDATE_DEBUG) {
    console.error('[DEBUG] VALIDATE_DEBUG=1 — logging all MCP request/response details');
  } else if (stage !== 'handshake') {
    console.error('[DEBUG] Tip: Set VALIDATE_DEBUG=1 to log Content-Type and raw body for every request');
  }

  printStep('initialize');
  const init = await post(initializeRequest);
  ensureOk(init, 'initialize failed');

  state.sessionId = init.sessionId;
  if (!state.sessionId) {
    if (!hasReached('discover')) {
      console.log(`  (no mcp-session-id returned)`);
      console.log(`  success: initialize`);
      console.log('\nHandshake validation passed.');
      return;
    }
    fail(
      'Staged validation (discover and beyond) requires sessioned mode (DISABLE_SESSION_MANAGEMENT=false). No mcp-session-id was returned, which usually means stateless mode or broken session setup. Handshake works in both modes.',
    );
  }

  console.log(`  success: initialize`);
  console.log(`  mcp-session-id: ${state.sessionId}`);

  if (!hasReached('discover')) {
    console.log('\nHandshake validation passed.');
    return;
  }

  printStep('tools/list');
  const list = await post(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    },
    state.sessionId,
  );
  ensureOk(list, 'tools/list failed');

  const tools = list.data.result?.tools ?? [];
  const toolNames = tools.map((tool) => tool.name).filter((name): name is string => !!name);
  console.log(`  success: tools/list`);
  console.log(`  tools discovered: ${toolNames.length}`);

  if (toolNames.length === 0) {
    console.error('[DEBUG] tools/list returned 0 tools. Parsed result:', JSON.stringify(list.data));
  }
  console.log(`  joe-flow tools present: ${requiredJoeFlowTools.every((name) => toolNames.includes(name))}`);

  for (const requiredTool of requiredJoeFlowTools) {
    if (!toolNames.includes(requiredTool)) {
      fail(`Required tool "${requiredTool}" not found in tools/list.`);
    }
  }

  if (shouldRunSearchStage()) {
    if (!searchArgs) {
      if (stage === 'search' || stage === 'full') {
        fail(
          'Stage requires search-content inputs. Provide SEARCH_TERMS or SEARCH_CONTENT_ARGS_JSON.',
        );
      }
    } else {
      const result = await callTool('search-content', searchArgs, 3);
      if (!Array.isArray(result)) {
        fail('search-content returned an unexpected result shape.');
      }

      state.searchResults = result;
      const candidates = extractDatasourceCandidatesFromSearch(result);
      state.datasourceCandidates.push(...candidates);
      console.log(`  search results: ${result.length}`);
      console.log(`  datasource candidates from search: ${candidates.length}`);
    }
  }

  if (shouldRunDatasourceStage()) {
    if (!listDatasourceArgs) {
      if (stage === 'datasource' || stage === 'full') {
        fail(
          'Stage requires list-datasources inputs. Provide DATASOURCE_FILTER or LIST_DATASOURCES_ARGS_JSON.',
        );
      }
    } else {
      const result = await callTool('list-datasources', listDatasourceArgs, 4);
      if (!Array.isArray(result)) {
        fail('list-datasources returned an unexpected result shape.');
      }

      const candidates = extractDatasourceCandidatesFromList(result);
      state.datasourceCandidates.push(...candidates);
      console.log(`  datasources returned: ${result.length}`);
      console.log(`  datasource ids found: ${candidates.length}`);
    }
  }

  if (shouldRunMetadataStage()) {
    state.selectedDatasourceLuid = selectDatasourceLuid();
    const datasourceLuid = requireValue(
      state.selectedDatasourceLuid,
      'Stage requires DATASOURCE_LUID, or an earlier stage must produce exactly one datasource candidate.',
    );

    const result = await callTool('get-datasource-metadata', { datasourceLuid }, 5);
    if (!result || typeof result !== 'object') {
      fail('get-datasource-metadata returned an unexpected result shape.');
    }

    state.metadata = result;
    const metadataRecord = result as Record<string, unknown>;
    const fieldGroups = Array.isArray(metadataRecord.fieldGroups) ? metadataRecord.fieldGroups : [];
    const parameters = Array.isArray(metadataRecord.parameters) ? metadataRecord.parameters : [];
    console.log(`  datasourceLuid: ${datasourceLuid}`);
    console.log(`  fieldGroups: ${fieldGroups.length}`);
    console.log(`  parameters: ${parameters.length}`);
  }

  if (hasReached('query')) {
    if (!queryDatasourceArgs) {
      fail(
        'Stage requires QUERY_DATASOURCE_ARGS_JSON. The repo supports query-datasource, but the query body must come from real metadata and human-provided intent.',
      );
    }

    const queryArgs: JsonObject = { ...queryDatasourceArgs };
    if (
      !('datasourceLuid' in queryArgs) ||
      typeof queryArgs.datasourceLuid !== 'string' ||
      !queryArgs.datasourceLuid
    ) {
      const datasourceLuid = selectDatasourceLuid();
      if (datasourceLuid) {
        queryArgs.datasourceLuid = datasourceLuid;
      }
    }

    if (typeof queryArgs.datasourceLuid !== 'string' || !queryArgs.datasourceLuid) {
      fail(
        'QUERY_DATASOURCE_ARGS_JSON must include datasourceLuid, or DATASOURCE_LUID must be provided/inferred earlier.',
      );
    }

    const result = await callTool('query-datasource', queryArgs, 6);
    if (!result || typeof result !== 'object') {
      fail('query-datasource returned an unexpected result shape.');
    }

    state.queryResult = result;
    const queryRecord = result as Record<string, unknown>;
    const rows = Array.isArray(queryRecord.data) ? queryRecord.data : [];
    const warnings =
      queryRecord.mcp && typeof queryRecord.mcp === 'object'
        ? ((queryRecord.mcp as Record<string, unknown>).warnings as unknown[])
        : [];

    console.log(`  datasourceLuid: ${String(queryArgs.datasourceLuid)}`);
    console.log(`  rows returned: ${rows.length}`);
    if (Array.isArray(warnings) && warnings.length > 0) {
      console.log(`  warnings: ${warnings.length}`);
    }
  }

  console.log('\nValidation completed successfully.');
})();
