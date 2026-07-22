/**
 * Multi-agent eval runner for the Tableau MCP server.
 *
 * Drives Claude Code, Cursor, or Codex (selected by AGENT_HARNESS) against the
 * Tableau MCP server for a single case. Tracing is handled by the official LangSmith
 * coding-agent plugin for the selected agent (enabled via env in the adapter); this
 * runner only spawns the CLI, stamps the `eval_run_id` correlation metadata, and
 * records run metadata. Grading reads the trace back from LangSmith.
 *
 * Usage:
 *   npx tsx evals/run-case.ts evals/cases/list-datasources.json [--run-id <id>]
 *   npx tsx evals/run-case.ts input "sales by region" [--run-id <id>]
 *
 * Required environment:
 *   LANGSMITH_API_KEY (or LANGCHAIN_API_KEY), LANGSMITH_PROJECT
 *   SERVER plus a supported Tableau auth config, e.g.
 *     AUTH=pat SITE_NAME=<site> PAT_NAME=<name> PAT_VALUE=<secret>
 * Optional:
 *   AGENT_HARNESS=claude-code|cursor|codex (default claude-code), AGENT_MODEL=<model>
 */

/* eslint-disable no-console */

import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { AgentInvocation, getAdapter, resolveHarness, RunContext } from './adapters/index.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const EVALS_DIR = path.join(REPO_ROOT, 'evals');
const RUNS_DIR = path.join(EVALS_DIR, 'runs');
const MCP_SERVER_ENTRY = path.join(REPO_ROOT, 'build', 'index.js');

function dateSlug(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

const args = process.argv.slice(2);
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));

function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (positionalArgs.length === 0) {
  console.error(
    'Usage: npx tsx evals/run-case.ts <case-file> [--run-id <id>] [--agent-harness <h>] [--agent-model <m>]\n' +
      '   or: npx tsx evals/run-case.ts input "<ad hoc user message>" [--run-id <id>]',
  );
  process.exit(1);
}

const runIdArg = getArgValue('--run-id');
const suiteRunId = getArgValue('--suite-run-id') ?? null;

const harness = resolveHarness(getArgValue('--agent-harness'), 'AGENT_HARNESS');
const adapter = getAdapter(harness);
const model = adapter.resolveModel(getArgValue('--agent-model') ?? process.env.AGENT_MODEL);

const langSmithApiKey = process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY ?? '';
const langSmithProject = process.env.LANGSMITH_PROJECT ?? 'tableau-mcp-evals';
const langSmithEndpoint = process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com';

const evalCase = loadEvalCase(positionalArgs);
const runId = runIdArg ?? `${evalCase.id}-${Date.now()}-${randomUUID().slice(0, 8)}`;
const runDir = path.join(RUNS_DIR, dateSlug(), runId);

const budget = {
  maxToolCalls: evalCase.budget?.max_tool_calls ?? 20,
  maxWallMs: evalCase.budget?.max_wall_ms ?? 5 * 60 * 1000,
};

preflight();
fs.mkdirSync(runDir, { recursive: true });

const prompt = expandTemplate(evalCase.prompt);
const startedAt = new Date().toISOString();

const questionId =
  typeof evalCase.metadata?.question_id === 'number'
    ? (evalCase.metadata.question_id as number)
    : null;

const runContext: RunContext = {
  runId,
  suiteRunId,
  runDir,
  prompt,
  model,
  mcpServerEntry: MCP_SERVER_ENTRY,
  mcpServerEnv: tableauServerEnv(),
  questionId,
  langsmith: { apiKey: langSmithApiKey, project: langSmithProject, endpoint: langSmithEndpoint },
  budget,
};

const runMeta = {
  run_id: runId,
  suite_run_id: suiteRunId,
  case_id: evalCase.id,
  name: evalCase.name ?? evalCase.id,
  description: evalCase.description ?? null,
  started_at: startedAt,
  prompt,
  harness,
  model: model || null,
  eval_run_id: runId,
  langsmith_project: langSmithProject,
  expected_tools: evalCase.expected_tools ?? [],
  tags: evalCase.tags ?? [],
  metadata: evalCase.metadata ?? {},
  budget,
  git_sha: tryExec('git', ['rev-parse', 'HEAD']),
  git_branch: tryExec('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
};

adapter.writeConfig(runContext);
fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(runMeta, null, 2));

console.log(`\nRun ID:            ${runId}`);
console.log(`Harness / model:   ${harness} / ${model || '(cli default)'}`);
console.log(`LangSmith project: ${langSmithProject}`);
console.log(`Run dir:           ${runDir}`);

const invocation: AgentInvocation = adapter.buildInvocation(runContext);

const startMs = Date.now();
let exitCode = 0;
let stdout = '';
let errorMessage: string | undefined;

try {
  stdout = execFileSync(invocation.command, invocation.args, {
    env: { ...process.env, ...invocation.env },
    cwd: invocation.cwd,
    timeout: invocation.timeoutMs,
    maxBuffer: 25 * 1024 * 1024,
  }).toString();
} catch (error: unknown) {
  const e = error as { status?: number; stdout?: Buffer; stderr?: Buffer; message?: string };
  exitCode = e.status ?? 1;
  stdout = e.stdout?.toString() ?? '';
  errorMessage = [e.message, e.stderr?.toString()].filter(Boolean).join('\n');
  console.error(`${invocation.command} exited with code ${exitCode}`);
  if (errorMessage) console.error(errorMessage);
}

const finishedAt = new Date().toISOString();
const wallMs = Date.now() - startMs;

// Raw agent stdout is persisted for human debugging only — never a grading input.
fs.writeFileSync(path.join(runDir, 'agent-output.jsonl'), stdout);

const finishedMeta = {
  ...runMeta,
  finished_at: finishedAt,
  wall_ms: wallMs,
  agent_exit_code: exitCode,
  timed_out: wallMs >= budget.maxWallMs,
  error: errorMessage ?? null,
};
fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(finishedMeta, null, 2));

console.log(`\nRun complete in ${wallMs}ms (exit ${exitCode})`);
console.log(`Run dir: ${runDir}`);
console.log(`To grade locally: npx tsx ${path.join(EVALS_DIR, 'grade.ts')} ${runDir}`);

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadEvalCase(positional: Array<string>): EvalCase {
  const [modeOrPath, ...rest] = positional;
  if (modeOrPath === 'input') {
    const message = rest.join(' ').trim();
    if (!message) {
      throw new Error('Ad hoc input mode requires a message, for example: input "sales by region"');
    }
    return {
      id: `adhoc-${slugify(message)}`,
      name: `Ad Hoc: ${message.slice(0, 80)}`,
      description: 'Ad hoc coding-agent session against the Tableau MCP server.',
      prompt: message,
      tags: ['adhoc', 'real-server'],
      metadata: { source: 'cli-input' },
      budget: { max_tool_calls: 20, max_wall_ms: 5 * 60 * 1000 },
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

/** Environment passed through to the Tableau MCP stdio server subprocess. */
function tableauServerEnv(): Record<string, string> {
  const keys = [
    'SERVER',
    'SITE_NAME',
    'AUTH',
    'PAT_NAME',
    'PAT_VALUE',
    'JWT',
    'USERNAME',
    'PASSWORD',
    'CONNECTED_APP_CLIENT_ID',
    'CONNECTED_APP_SECRET_ID',
    'CONNECTED_APP_SECRET_VALUE',
    'DATASOURCE_CREDENTIALS',
    'DEFAULT_LOG_LEVEL',
    'INCLUDE_TOOLS',
    'EXCLUDE_TOOLS',
    'MAX_RESULT_LIMIT',
    'DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION',
    'DISABLE_METADATA_API_REQUESTS',
    'FLOW_TOOLS_ENABLED',
  ];
  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value != null && value !== '') env[key] = value;
  }
  return env;
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

function expandTemplate(value: string): string {
  return value.replace(/\{\{env\.([A-Z0-9_]+)\}\}/g, (_match, name: string) => {
    const envValue = process.env[name];
    if (!envValue) {
      throw new Error(`Prompt references {{env.${name}}}, but ${name} is not set.`);
    }
    return envValue;
  });
}

function tryExec(command: string, commandArgs: Array<string>): string | null {
  try {
    return execFileSync(command, commandArgs, { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return null;
  }
}
