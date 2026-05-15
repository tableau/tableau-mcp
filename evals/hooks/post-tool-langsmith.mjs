#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook.
 *
 * Reads the hook envelope from stdin and creates a child LangSmith tool run
 * under LANGSMITH_PARENT_RUN_ID. The runner sets all required environment
 * variables; no secrets are written to disk by this hook.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const input = await readStdin();
const envelope = parseJson(input);

if (!envelope) {
  process.exit(0);
}

const apiKey = process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY;
const parentRunId = process.env.LANGSMITH_PARENT_RUN_ID;
const project = process.env.LANGSMITH_PROJECT ?? 'tableau-mcp-evals';
const endpoint = process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com';
const runId = process.env.TMCP_EVAL_RUN_ID;
const runDir = process.env.TMCP_EVAL_RUN_DIR;
const childRunsLog = process.env.TMCP_EVAL_CHILD_RUNS_LOG;
const hookLog = process.env.TMCP_EVAL_HOOK_LOG;

if (!apiKey || !parentRunId) {
  appendJsonl(hookLog, {
    ts: new Date().toISOString(),
    warning: 'LANGSMITH_API_KEY/LANGCHAIN_API_KEY or LANGSMITH_PARENT_RUN_ID is not set',
    tool_name: envelope.tool_name ?? null,
  });
  process.exit(0);
}

const now = new Date().toISOString();
const toolName = String(envelope.tool_name ?? 'unknown-tool');
const childRunId = randomUUID();
const isFailure = envelope.hook_event_name === 'PostToolUseFailure';

// Estimate tool start time. The hook fires at completion so `now` is the end.
// Use the previous hook record's timestamp as the start (end of the last tool call
// or the run's started_at for the first call). This gives the waterfall real width.
const startTime = estimateToolStartTime();
const toolResponse = envelope.tool_response ?? envelope.tool_output ?? envelope.error ?? null;

const langSmithRun = {
  id: childRunId,
  name: normalizeToolName(toolName),
  run_type: 'tool',
  inputs: truncateValue({
    tool_name: toolName,
    tool_input: envelope.tool_input ?? null,
  }),
  outputs: truncateValue({
    tool_response: toolResponse,
  }),
  start_time: startTime,
  end_time: now,
  parent_run_id: parentRunId,
  session_name: project,
  tags: ['tmcp-eval', 'claude-code', 'mcp-tool', normalizeToolName(toolName)],
  error: isFailure ? stringifyError(toolResponse) : undefined,
  extra: {
    run_id: runId,
    hook_event_name: envelope.hook_event_name ?? null,
    session_id: envelope.session_id ?? null,
    transcript_path: envelope.transcript_path ?? null,
    tool_use_id: envelope.tool_use_id ?? null,
    raw_tool_name: toolName,
  },
};

appendJsonl(hookLog, {
  ts: now,
  start_time: startTime,
  run_id: runId,
  langsmith_run_id: childRunId,
  langsmith_parent_run_id: parentRunId,
  hook_event_name: envelope.hook_event_name ?? null,
  tool_name: toolName,
  normalized_tool_name: normalizeToolName(toolName),
  tool_use_id: envelope.tool_use_id ?? null,
  tool_input: envelope.tool_input ?? null,
});

try {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(langSmithRun),
  });

  const responseBody = await response.text();
  appendJsonl(childRunsLog, {
    ts: now,
    child_run_id: childRunId,
    parent_run_id: parentRunId,
    tool_name: toolName,
    status: response.status,
    ok: response.ok,
    response: responseBody ? safeJsonOrText(responseBody) : null,
  });

  if (!response.ok) {
    process.exit(0);
  }
} catch (error) {
  appendJsonl(childRunsLog, {
    ts: now,
    child_run_id: childRunId,
    parent_run_id: parentRunId,
    tool_name: toolName,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function estimateToolStartTime() {
  // Prefer the PreToolUse timestamp for this exact tool_use_id — true dispatch time.
  const toolUseId = envelope.tool_use_id;
  if (runDir && toolUseId) {
    const preToolTimesPath = path.join(runDir, 'pre-tool-times.jsonl');
    if (fs.existsSync(preToolTimesPath)) {
      const lines = fs.readFileSync(preToolTimesPath, 'utf-8').trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const record = parseJson(lines[i]);
        if (record?.tool_use_id === toolUseId && record?.ts) return record.ts;
      }
    }
  }
  // Fall back to now (0ms duration) if PreToolUse record is missing.
  return now;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function appendJsonl(filePath, value) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function normalizeToolName(toolNameValue) {
  const parts = toolNameValue.split('__');
  return parts[parts.length - 1] || toolNameValue;
}

function truncateValue(value) {
  const maxChars = Number(process.env.LANGSMITH_MAX_PAYLOAD_CHARS ?? 200_000);
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return value;
  return {
    truncated: true,
    preview: serialized.slice(0, maxChars),
  };
}

function stringifyError(value) {
  if (!value) return 'Claude Code reported tool failure';
  return typeof value === 'string' ? value : JSON.stringify(truncateValue(value));
}

function safeJsonOrText(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
