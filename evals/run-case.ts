/**
 * Claude Code + LangSmith eval runner for the Tableau MCP server.
 *
 * Usage:
 *   npx tsx evals/run-case.ts evals/cases/list-datasources.json
 *   npx tsx evals/run-case.ts input "sales by region"
 *
 * Required environment:
 *   LANGSMITH_API_KEY or LANGCHAIN_API_KEY
 *   SERVER plus one supported Tableau auth configuration, for example:
 *   AUTH=pat SITE_NAME=<site> PAT_NAME=<name> PAT_VALUE=<secret>
 */

/* eslint-disable no-console */

import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const EVALS_DIR = path.join(REPO_ROOT, 'evals');
const RUNS_DIR = path.join(EVALS_DIR, 'runs');
const HOOKS_DIR = path.join(EVALS_DIR, 'hooks');

function dateSlug(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const MCP_SERVER_ENTRY = path.join(REPO_ROOT, 'build', 'index.js');

type EvalCase = {
  id: string;
  name?: string;
  description?: string;
  prompt: string;
  expected_tools?: Array<string>;
  tags?: Array<string>;
  metadata?: Record<string, unknown>;
  budget?: {
    max_tool_calls?: number;
    max_wall_ms?: number;
  };
};

type LangSmithRun = {
  id: string;
  name: string;
  run_type: 'chain' | 'tool' | 'llm';
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  start_time?: string;
  end_time?: string;
  parent_run_id?: string;
  session_name?: string;
  tags?: Array<string>;
  extra?: Record<string, unknown>;
  error?: string;
};

const args = process.argv.slice(2);
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
const runIdArg = getArgValue('--run-id');

if (positionalArgs.length === 0) {
  console.error(
    'Usage: npx tsx evals/run-case.ts <case-file> [--run-id <id>]\n' +
      '   or: npx tsx evals/run-case.ts input "<ad hoc user message>" [--run-id <id>]',
  );
  process.exit(1);
}

const evalCase = loadEvalCase(positionalArgs);
const runId = runIdArg ?? `${evalCase.id}-${Date.now()}-${randomUUID().slice(0, 8)}`;
const runDir = path.join(RUNS_DIR, dateSlug(), runId);
const logsDir = path.join(runDir, 'logs');
const hookLog = path.join(runDir, 'hook.jsonl');
const childRunsLog = path.join(runDir, 'langsmith-child-runs.jsonl');
const messageRunsLog = path.join(runDir, 'langsmith-message-runs.jsonl');
const settingsPath = path.join(runDir, 'claude-settings.json');
const mcpConfigPath = path.join(runDir, 'mcp-config.json');

const langSmithApiKey = process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY;
const langSmithProject = process.env.LANGSMITH_PROJECT ?? 'tableau-mcp-evals';
const langSmithEndpoint = process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com';
const budget = {
  max_tool_calls: evalCase.budget?.max_tool_calls ?? 20,
  max_wall_ms: evalCase.budget?.max_wall_ms ?? 5 * 60 * 1000,
};

preflight();
fs.mkdirSync(logsDir, { recursive: true });

const prompt = expandTemplate(evalCase.prompt);
const parentRunId = randomUUID();
const startedAt = new Date().toISOString();

const runMeta = {
  run_id: runId,
  case_id: evalCase.id,
  name: evalCase.name ?? evalCase.id,
  description: evalCase.description ?? null,
  started_at: startedAt,
  prompt,
  expected_tools: evalCase.expected_tools ?? [],
  tags: evalCase.tags ?? [],
  metadata: evalCase.metadata ?? {},
  budget,
  langsmith: {
    project: langSmithProject,
    endpoint: langSmithEndpoint,
    parent_run_id: parentRunId,
  },
  git_sha: tryExec('git', ['rev-parse', 'HEAD']),
  git_branch: tryExec('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
};

fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(runMeta, null, 2));
writeClaudeSettings();
writeMcpConfig();

console.log(`\nRun ID: ${runId}`);
console.log(`Run dir: ${runDir}`);
console.log(`LangSmith project: ${langSmithProject}`);

createLangSmithRun({
  id: parentRunId,
  name: evalCase.name ?? evalCase.id,
  run_type: 'chain',
  inputs: { prompt, case: evalCase },
  start_time: startedAt,
  session_name: langSmithProject,
  tags: ['tmcp-eval', 'claude-code', ...(evalCase.tags ?? [])],
  extra: {
    run_id: runId,
    case_id: evalCase.id,
    git_sha: runMeta.git_sha,
    git_branch: runMeta.git_branch,
    expected_tools: evalCase.expected_tools ?? [],
  },
});

const startMs = Date.now();
let claudeExitCode = 0;
let agentOutput = '';
let errorMessage: string | undefined;

try {
  const output = execFileSync(
    'claude',
    [
      '--settings',
      settingsPath,
      '--mcp-config',
      mcpConfigPath,
      '--strict-mcp-config',
      '--allowedTools',
      'ToolSearch,mcp__tableau__*',
      '--output-format',
      'stream-json',
      '--verbose',
      '-p',
      prompt,
    ],
    {
      env: {
        ...process.env,
        LANGSMITH_API_KEY: langSmithApiKey,
        LANGSMITH_PROJECT: langSmithProject,
        LANGSMITH_ENDPOINT: langSmithEndpoint,
        LANGSMITH_PARENT_RUN_ID: parentRunId,
        TMCP_EVAL_RUN_ID: runId,
        TMCP_EVAL_RUN_DIR: runDir,
        TMCP_EVAL_HOOK_LOG: hookLog,
        TMCP_EVAL_CHILD_RUNS_LOG: childRunsLog,
      },
      cwd: REPO_ROOT,
      timeout: budget.max_wall_ms + 10_000,
      maxBuffer: 25 * 1024 * 1024,
    },
  );
  agentOutput = output.toString();
} catch (error: unknown) {
  const execError = error as {
    status?: number;
    stdout?: Buffer;
    stderr?: Buffer;
    message?: string;
  };
  claudeExitCode = execError.status ?? 1;
  agentOutput = execError.stdout?.toString() ?? '';
  errorMessage = [execError.message, execError.stderr?.toString()].filter(Boolean).join('\n');
  console.error(`claude exited with code ${claudeExitCode}`);
  if (errorMessage) console.error(errorMessage);
}

const finishedAt = new Date().toISOString();
const wallMs = Date.now() - startMs;
fs.writeFileSync(path.join(runDir, 'agent-output.jsonl'), agentOutput);
const messageTracePosts = postClaudeStreamEvents(agentOutput, parentRunId);
fs.writeFileSync(
  path.join(runDir, 'langsmith-message-runs.json'),
  JSON.stringify(messageTracePosts, null, 2),
);

const finishedMeta = {
  ...runMeta,
  finished_at: finishedAt,
  wall_ms: wallMs,
  claude_exit_code: claudeExitCode,
  timed_out: wallMs >= budget.max_wall_ms,
  error: errorMessage ?? null,
};
fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(finishedMeta, null, 2));

const stopPath = path.join(runDir, 'stop.json');
const stopData = fs.existsSync(stopPath)
  ? (JSON.parse(fs.readFileSync(stopPath, 'utf-8')) as Record<string, unknown>)
  : {};

const finalLangSmithUpdate = tryUpdateLangSmithRun(parentRunId, {
  outputs: {
    success: claudeExitCode === 0,
    agent_output_jsonl: truncate(agentOutput),
    message_trace_posts: messageTracePosts,
    stop: stopData,
  },
  end_time: finishedAt,
  error: errorMessage,
  extra: {
    ...runMeta.langsmith,
    wall_ms: wallMs,
    claude_exit_code: claudeExitCode,
    timed_out: wallMs >= budget.max_wall_ms,
    message_trace_posts: messageTracePosts,
    stop: stopData,
  },
});
fs.writeFileSync(
  path.join(runDir, 'langsmith-final-update.json'),
  JSON.stringify(finalLangSmithUpdate, null, 2),
);

console.log(`\nRun complete in ${wallMs}ms (exit ${claudeExitCode})`);
console.log(`Parent LangSmith run: ${parentRunId}`);
if (!finalLangSmithUpdate.ok) {
  console.warn(`Final LangSmith update failed: ${finalLangSmithUpdate.error}`);
}
console.log(`Run dir: ${runDir}`);
console.log(`To grade locally: npx tsx evals/grade.ts ${runDir}`);

function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function loadEvalCase(positional: Array<string>): EvalCase {
  const [modeOrPath, ...rest] = positional;
  if (modeOrPath === 'input') {
    const message = rest.join(' ').trim();
    if (!message) {
      throw new Error('Ad hoc input mode requires a message, for example: input "sales by region"');
    }
    const slug = slugify(message);
    return {
      id: `adhoc-${slug}`,
      name: `Ad Hoc: ${message.slice(0, 80)}`,
      description: 'Ad hoc Claude Code session against the Tableau MCP server.',
      prompt: message,
      tags: ['adhoc', 'real-server'],
      metadata: {
        source: 'cli-input',
      },
      budget: {
        max_tool_calls: 20,
        max_wall_ms: 5 * 60 * 1000,
      },
    };
  }

  return JSON.parse(fs.readFileSync(path.resolve(modeOrPath), 'utf-8')) as EvalCase;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return slug || 'input';
}

function preflight(): void {
  if (!langSmithApiKey) {
    throw new Error('LANGSMITH_API_KEY or LANGCHAIN_API_KEY must be set.');
  }
  if (!fs.existsSync(MCP_SERVER_ENTRY)) {
    throw new Error(`MCP server build not found at ${MCP_SERVER_ENTRY}. Run npm run build first.`);
  }
  if (!process.env.SERVER && process.env.AUTH !== 'oauth') {
    throw new Error('SERVER must be set for real Tableau Cloud/Server evals.');
  }
  const auth = process.env.AUTH ?? 'pat';
  if (auth === 'pat' && (!process.env.PAT_NAME || !process.env.PAT_VALUE)) {
    throw new Error('PAT_NAME and PAT_VALUE must be set when AUTH is "pat" or unset.');
  }
}

function writeClaudeSettings(): void {
  const preToolHook = path.join(HOOKS_DIR, 'pre-tool-langsmith.mjs');
  const postToolHook = path.join(HOOKS_DIR, 'post-tool-langsmith.mjs');
  const stopHook = path.join(HOOKS_DIR, 'stop-langsmith.mjs');
  const claudeSettings = {
    hooks: {
      PreToolUse: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: `node ${JSON.stringify(preToolHook)}` }],
        },
      ],
      PostToolUse: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: `node ${JSON.stringify(postToolHook)}` }],
        },
      ],
      PostToolUseFailure: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: `node ${JSON.stringify(postToolHook)}` }],
        },
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: `node ${JSON.stringify(stopHook)}` }],
        },
      ],
    },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(claudeSettings, null, 2));
}

function writeMcpConfig(): void {
  const mcpConfig = {
    mcpServers: {
      tableau: {
        command: 'node',
        args: [MCP_SERVER_ENTRY],
        env: {
          TRANSPORT: 'stdio',
          TMCP_EVAL_RUN_ID: runId,
          FILE_LOGGER_DIRECTORY: logsDir,
          ENABLED_LOGGERS: 'fileLogger',
        },
      },
    },
  };
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
}

function expandTemplate(value: string): string {
  return value.replace(/\{\{env\.([A-Z0-9_]+)\}\}/g, (_match, name: string) => {
    const envValue = process.env[name];
    if (!envValue) {
      throw new Error(`Prompt references {{env.${name}}}, but ${name} is not set.`);
    }
    return envValue;
  });
}

function createLangSmithRun(run: LangSmithRun): void {
  requestLangSmith('/runs', 'POST', run);
}

function tryCreateLangSmithRun(run: LangSmithRun): { ok: true } | { ok: false; error: string } {
  try {
    createLangSmithRun(run);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function updateLangSmithRun(runIdToUpdate: string, body: Partial<LangSmithRun>): void {
  requestLangSmith(`/runs/${runIdToUpdate}`, 'PATCH', body);
}

function tryUpdateLangSmithRun(
  runIdToUpdate: string,
  body: Partial<LangSmithRun>,
): { ok: true } | { ok: false; error: string } {
  try {
    updateLangSmithRun(runIdToUpdate, body);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function requestLangSmith(pathSuffix: string, method: 'POST' | 'PATCH', body: unknown): void {
  const endpoint = `${langSmithEndpoint.replace(/\/$/, '')}${pathSuffix}`;
  const response = fetchSync(endpoint, method, body);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `LangSmith ${method} ${pathSuffix} failed: ${response.status} ${response.body}`,
    );
  }
}

function fetchSync(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): { status: number; body: string } {
  const script = `
const url = process.argv[1];
const method = process.argv[2];
const body = JSON.parse(process.argv[3]);
fetch(url, {
  method,
  headers: {
    'content-type': 'application/json',
    'x-api-key': process.env.LANGSMITH_API_KEY,
  },
  body: JSON.stringify(body),
}).then(async (response) => {
  console.log(JSON.stringify({ status: response.status, body: await response.text() }));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
  const output = execFileSync(process.execPath, ['-e', script, url, method, JSON.stringify(body)], {
    env: { ...process.env, LANGSMITH_API_KEY: langSmithApiKey },
    maxBuffer: 10 * 1024 * 1024,
  }).toString();
  return JSON.parse(output) as { status: number; body: string };
}

function tryExec(command: string, commandArgs: Array<string>): string | null {
  try {
    return execFileSync(command, commandArgs, { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return null;
  }
}

type ClaudeStreamEvent = {
  type?: string;
  subtype?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: unknown;
    usage?: unknown;
  };
  result?: string;
  usage?: unknown;
  modelUsage?: unknown;
  uuid?: string;
  session_id?: string;
  timestamp?: string;
  [key: string]: unknown;
};

/**
 * Build a map of stream event index → real timestamp using PreToolUse and PostToolUse
 * hook records as anchors.
 *
 * For each assistant event that contains a tool_use content block:
 *   - The event's own time is set to the PreToolUse dispatch timestamp (tool call start)
 *   - The immediately following event's time is set to the PostToolUse timestamp (tool call end)
 *
 * These anchors are passed into inferEventTimes so interpolation only fills the gaps
 * between real data points rather than spreading linearly across the whole session.
 */
function buildToolTimeAnchors(events: Array<ClaudeStreamEvent>): Map<number, number> {
  const anchors = new Map<number, number>();

  const preToolPath = path.join(runDir, 'pre-tool-times.jsonl');
  const preToolRecords = fs.existsSync(preToolPath)
    ? parseJsonl<{ ts: string; tool_use_id: string }>(fs.readFileSync(preToolPath, 'utf-8'))
    : [];
  const dispatchTimes = new Map<string, number>();
  for (const r of preToolRecords) {
    if (r.tool_use_id && r.ts) dispatchTimes.set(r.tool_use_id, new Date(r.ts).getTime());
  }

  const hookRecords = fs.existsSync(hookLog)
    ? parseJsonl<{ ts: string; tool_use_id?: string }>(fs.readFileSync(hookLog, 'utf-8'))
    : [];
  const completeTimes = new Map<string, number>();
  for (const r of hookRecords) {
    if (r.tool_use_id && r.ts) completeTimes.set(r.tool_use_id, new Date(r.ts).getTime());
  }

  if (dispatchTimes.size === 0 && completeTimes.size === 0) return anchors;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) continue;

    const content = event.message.content as Array<{ type?: string; id?: string }>;
    const toolUseBlock = content.find((b) => b.type === 'tool_use' && b.id);
    if (!toolUseBlock?.id) continue;

    const dispatchMs = dispatchTimes.get(toolUseBlock.id);
    if (dispatchMs != null) anchors.set(i, dispatchMs);

    const completeMs = completeTimes.get(toolUseBlock.id);
    if (completeMs != null && i + 1 < events.length) anchors.set(i + 1, completeMs);
  }

  return anchors;
}

function postClaudeStreamEvents(
  streamJsonl: string,
  parentRunIdToUse: string,
): {
  total_events: number;
  posted: number;
  failed: number;
} {
  const events = parseJsonl<ClaudeStreamEvent>(streamJsonl);
  const toolTimeAnchors = buildToolTimeAnchors(events);
  const eventTimes = inferEventTimes(events, toolTimeAnchors);
  const traceableEvents = events
    .map((event, streamIndex) => ({ event, streamIndex }))
    .filter(({ event }) => event.type === 'assistant' || event.type === 'result');

  let posted = 0;
  let failed = 0;

  // Post a synthetic initialization span covering Claude Code startup time —
  // the gap from when the process was launched to the first stream event.
  const firstEventTime =
    traceableEvents.length > 0
      ? (eventTimes[traceableEvents[0].streamIndex] ?? startedAt)
      : startedAt;
  if (firstEventTime > startedAt) {
    const initResult = tryCreateLangSmithRun({
      id: randomUUID(),
      name: 'initialization',
      run_type: 'chain',
      inputs: { prompt },
      outputs: {},
      start_time: startedAt,
      end_time: firstEventTime,
      parent_run_id: parentRunIdToUse,
      session_name: langSmithProject,
      tags: ['tmcp-eval', 'claude-code', 'initialization'],
      extra: { run_id: runId, description: 'Claude Code startup and MCP server initialization' },
    });
    if (initResult.ok) posted += 1;
    else failed += 1;
  }

  traceableEvents.forEach(({ event, streamIndex }, index) => {
    const childRunId = randomUUID();
    const isAssistant = event.type === 'assistant';
    const name = isAssistant
      ? `assistant-message-${index + 1}`
      : `claude-result-${event.subtype ?? 'final'}`;
    const eventTime = eventTimes[streamIndex] ?? finishedAt;
    const nextTraceable = traceableEvents[index + 1];
    const endTime = nextTraceable
      ? (eventTimes[nextTraceable.streamIndex] ?? finishedAt)
      : finishedAt;
    const postResult = tryCreateLangSmithRun({
      id: childRunId,
      name,
      run_type: isAssistant ? 'llm' : 'chain',
      inputs: truncateJsonValue({
        prompt,
        event_index: index,
        stream_index: streamIndex,
        session_id: event.session_id ?? null,
      }) as Record<string, unknown>,
      outputs: truncateJsonValue({
        message: event.message ?? null,
        result: event.result ?? null,
        usage: event.usage ?? event.message?.usage ?? null,
        model_usage: event.modelUsage ?? null,
      }) as Record<string, unknown>,
      start_time: eventTime,
      end_time: endTime,
      parent_run_id: parentRunIdToUse,
      session_name: langSmithProject,
      tags: ['tmcp-eval', 'claude-code', isAssistant ? 'assistant-message' : 'claude-result'],
      extra: {
        run_id: runId,
        event_type: event.type ?? null,
        event_subtype: event.subtype ?? null,
        event_uuid: event.uuid ?? null,
        stream_index: streamIndex,
        inferred_timestamp: event.timestamp ? false : true,
        message_id: event.message?.id ?? null,
        model: event.message?.model ?? null,
      },
    });

    if (postResult.ok) {
      posted += 1;
    } else {
      failed += 1;
    }

    appendJsonl(messageRunsLog, {
      ts: new Date().toISOString(),
      child_run_id: childRunId,
      parent_run_id: parentRunIdToUse,
      name,
      stream_index: streamIndex,
      event_time: eventTime,
      ok: postResult.ok,
      error: postResult.ok ? null : postResult.error,
    });
  });

  return {
    total_events: traceableEvents.length,
    posted,
    failed,
  };
}

function inferEventTimes(
  events: Array<ClaudeStreamEvent>,
  anchors: Map<number, number> = new Map(),
): Array<string> {
  if (events.length === 0) return [];

  const startMs = new Date(startedAt).getTime();
  const finishMs = new Date(finishedAt).getTime();
  const explicitTimes = events.map((event, index) => {
    // Real hook-derived timestamps take highest priority.
    const anchor = anchors.get(index);
    if (anchor != null && Number.isFinite(anchor)) return anchor;
    if (event.timestamp) return new Date(event.timestamp).getTime();
    if (event.type === 'result') return finishMs;
    return null;
  });

  const inferredTimes = events.map((_event, index) => {
    const explicitTime = explicitTimes[index];
    if (explicitTime != null && Number.isFinite(explicitTime)) return explicitTime;

    const previousIndex = findPreviousExplicitTimeIndex(explicitTimes, index);
    const nextIndex = findNextExplicitTimeIndex(explicitTimes, index);

    if (previousIndex != null && nextIndex != null) {
      const previousTime = explicitTimes[previousIndex] ?? startMs;
      const nextTime = explicitTimes[nextIndex] ?? finishMs;
      const fraction = (index - previousIndex) / (nextIndex - previousIndex);
      return Math.round(previousTime + (nextTime - previousTime) * fraction);
    }

    if (previousIndex != null) {
      return (explicitTimes[previousIndex] ?? startMs) + (index - previousIndex) * 10;
    }

    if (nextIndex != null) {
      return (explicitTimes[nextIndex] ?? finishMs) - (nextIndex - index) * 10;
    }

    const fraction = events.length === 1 ? 0 : index / (events.length - 1);
    return Math.round(startMs + (finishMs - startMs) * fraction);
  });

  for (let index = 1; index < inferredTimes.length; index += 1) {
    if (inferredTimes[index] <= inferredTimes[index - 1]) {
      inferredTimes[index] = inferredTimes[index - 1] + 1;
    }
  }

  return inferredTimes.map((time) => new Date(time).toISOString());
}

function findPreviousExplicitTimeIndex(times: Array<number | null>, index: number): number | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (times[cursor] != null && Number.isFinite(times[cursor])) return cursor;
  }
  return null;
}

function findNextExplicitTimeIndex(times: Array<number | null>, index: number): number | null {
  for (let cursor = index + 1; cursor < times.length; cursor += 1) {
    if (times[cursor] != null && Number.isFinite(times[cursor])) return cursor;
  }
  return null;
}

function parseJsonl<T>(jsonl: string): Array<T> {
  return jsonl
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((event): event is T => event !== null);
}

function appendJsonl(filePath: string, value: unknown): void {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function truncate(value: string): string {
  const maxChars = Number(process.env.LANGSMITH_MAX_PAYLOAD_CHARS ?? 200_000);
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated]` : value;
}

function truncateJsonValue(value: unknown): unknown {
  const maxChars = Number(process.env.LANGSMITH_MAX_PAYLOAD_CHARS ?? 200_000);
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return value;
  return {
    truncated: true,
    preview: serialized.slice(0, maxChars),
  };
}
