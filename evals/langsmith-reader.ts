/**
 * LangSmith trace reader.
 *
 * The graders source all per-case metrics from the coding-agent trace in LangSmith
 * (single source of truth). This module fetches the root run for an eval by its
 * `eval_run_id` metadata (written by the runner into the plugin's custom metadata),
 * pulls the child runs of that trace, and normalizes them into a `TraceSummary`.
 */

import { Client, Run } from 'langsmith';

import { estimateCostUsd } from './pricing.js';

export type TraceToolCall = {
  name: string;
  normalizedName: string;
  inputs: unknown;
  outputs: unknown;
  error: string | null;
  startMs: number | null;
  endMs: number | null;
};

export type TraceTokens = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  total: number | null;
};

export type TraceSummary = {
  traceId: string;
  rootRunId: string;
  model: string | null;
  finalText: string;
  toolCalls: Array<TraceToolCall>;
  tokens: TraceTokens;
  costUsd: number | null;
  costSource: 'langsmith' | 'estimated' | 'unavailable';
  wallMs: number | null;
  ttftMs: number | null;
  llmRunCount: number;
  subagentCount: number;
  errorCount: number;
  hadError: boolean;
};

type KVMap = Record<string, unknown>;

export function makeClient(): Client {
  return new Client({
    apiKey: process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com',
  });
}

export function normalizeToolName(toolName: string): string {
  const parts = toolName.split('__');
  const raw = parts[parts.length - 1] || toolName;
  return raw.replace(/^tableau_/, '').replace(/^tableau-/, '');
}

function toMs(value: number | string | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getMetadata(run: Run): KVMap {
  const extra = (run.extra ?? {}) as KVMap;
  return (extra.metadata as KVMap) ?? {};
}

/** Deeply search an object for the first `{ fields?, filters? }` VizQL-shaped query. */
export function findVizqlQuery(value: unknown): { fields?: unknown; filters?: unknown } | null {
  if (value == null || typeof value !== 'object') return null;
  const obj = value as KVMap;
  if ('fields' in obj || 'filters' in obj) {
    return obj as { fields?: unknown; filters?: unknown };
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'object' && v !== null) {
      const found = findVizqlQuery(v);
      if (found) return found;
    }
  }
  return null;
}

/** Extract the assistant final text from a run's outputs, tolerating several shapes. */
export function extractTextFromOutputs(outputs: KVMap | undefined): string {
  if (!outputs) return '';
  const visit = (value: unknown, depth: number): string => {
    if (depth > 6 || value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      // Message arrays: prefer the last element with text content.
      for (let i = value.length - 1; i >= 0; i--) {
        const text = visit(value[i], depth + 1);
        if (text.trim()) return text;
      }
      return '';
    }
    if (typeof value === 'object') {
      const obj = value as KVMap;
      for (const key of ['output', 'result', 'text', 'content', 'message', 'messages', 'choices']) {
        if (key in obj) {
          const text = visit(obj[key], depth + 1);
          if (text.trim()) return text;
        }
      }
    }
    return '';
  };
  return visit(outputs, 0).trim();
}

function extractServerCost(run: Run): number | null {
  const anyRun = run as unknown as KVMap;
  for (const key of ['total_cost', 'totalCost']) {
    const v = anyRun[key];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function accumulateTokens(runs: Array<Run>): TraceTokens {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let found = false;

  for (const run of runs) {
    if (run.run_type !== 'llm') continue;
    const prompt = run.prompt_tokens ?? 0;
    const completion = run.completion_tokens ?? 0;
    if (run.prompt_tokens != null || run.completion_tokens != null) found = true;
    input += prompt;
    output += completion;

    // Cache detail lives on usage_metadata (coding-agent-v1 preserves it).
    const meta = getMetadata(run);
    const usage = (meta.usage_metadata ?? (run.extra as KVMap)?.usage_metadata) as
      | KVMap
      | undefined;
    if (usage) {
      const inputDetails = usage.input_token_details as KVMap | undefined;
      if (inputDetails) {
        const cr = Number(inputDetails.cache_read ?? 0);
        const cc = Number(inputDetails.cache_creation ?? inputDetails.cache_write ?? 0);
        if (Number.isFinite(cr)) cacheRead += cr;
        if (Number.isFinite(cc)) cacheWrite += cc;
        found = true;
      }
    }
  }

  if (!found) {
    return { input: null, output: null, cacheRead: null, cacheWrite: null, total: null };
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<Array<T>> {
  const out: Array<T> = [];
  for await (const item of iterable) out.push(item);
  return out;
}

async function findRootRun(
  client: Client,
  projectName: string,
  evalRunId: string,
): Promise<Run | null> {
  const filter = `has(metadata, '{"eval_run_id": "${evalRunId}"}')`;
  const runs = await collect(client.listRuns({ projectName, filter, isRoot: true, limit: 1 }));
  return runs[0] ?? null;
}

export type FetchOptions = {
  projectName: string;
  evalRunId: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
};

/**
 * Fetch and summarize the trace for an eval run, polling to absorb ingestion latency.
 * Returns null if no matching trace appears within the timeout (grader → grading_error).
 */
export async function fetchTraceSummary(
  client: Client,
  opts: FetchOptions,
): Promise<TraceSummary | null> {
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;

  let root: Run | null = null;
  for (;;) {
    root = await findRootRun(client, opts.projectName, opts.evalRunId);
    if (root || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  if (!root || !root.trace_id) return null;

  const allRuns = await collect(client.listRuns({ traceId: root.trace_id }));

  const toolRuns = allRuns.filter((r) => r.run_type === 'tool');
  const llmRuns = allRuns.filter((r) => r.run_type === 'llm');
  const subagentRuns = allRuns.filter(
    (r) => r.run_type === 'chain' && String(getMetadata(r).ls_run_type ?? '') === 'subagent',
  );

  const toolCalls: Array<TraceToolCall> = toolRuns.map((r) => ({
    name: r.name,
    normalizedName: normalizeToolName(r.name),
    inputs: r.inputs,
    outputs: r.outputs,
    error: r.error ?? null,
    startMs: toMs(r.start_time),
    endMs: toMs(r.end_time),
  }));

  const tokens = accumulateTokens(allRuns);
  const rootMeta = getMetadata(root);
  const model =
    (rootMeta.ls_model_name as string | undefined) ??
    llmRuns.map((r) => getMetadata(r).ls_model_name as string | undefined).find(Boolean) ??
    null;

  const rootStart = toMs(root.start_time);
  const rootEnd = toMs(root.end_time);
  const wallMs = rootStart != null && rootEnd != null ? rootEnd - rootStart : null;
  const firstLlmStart = llmRuns
    .map((r) => toMs(r.start_time))
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)[0];
  const ttftMs = rootStart != null && firstLlmStart != null ? firstLlmStart - rootStart : null;

  const errorRuns = allRuns.filter((r) => r.error != null && r.error !== '');

  let costUsd = extractServerCost(root);
  let costSource: TraceSummary['costSource'] = costUsd != null ? 'langsmith' : 'unavailable';
  if (costUsd == null) {
    const estimate = estimateCostUsd(model, {
      input: tokens.input,
      output: tokens.output,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
    });
    if (estimate != null) {
      costUsd = estimate;
      costSource = 'estimated';
    }
  }

  return {
    traceId: root.trace_id,
    rootRunId: root.id,
    model,
    finalText: extractTextFromOutputs(root.outputs as KVMap | undefined),
    toolCalls,
    tokens,
    costUsd,
    costSource,
    wallMs,
    ttftMs,
    llmRunCount: llmRuns.length,
    subagentCount: subagentRuns.length,
    errorCount: errorRuns.length,
    hadError: (root.error != null && root.error !== '') || errorRuns.length > 0,
  };
}
