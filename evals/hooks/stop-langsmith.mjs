#!/usr/bin/env node
/**
 * Claude Code Stop hook.
 *
 * Captures token usage from the Claude transcript and patches the parent
 * LangSmith run with stop-hook metadata. The runner also patches the parent
 * run after process exit with final stdout/status.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import fs from 'fs';
import path from 'path';

const input = await readStdin();
const envelope = parseJson(input) ?? {};
const runDir = process.env.TMCP_EVAL_RUN_DIR;
if (!runDir) {
  process.stderr.write('[stop-hook] TMCP_EVAL_RUN_DIR is not set — cannot write stop.json\n');
  process.exit(0);
}
const apiKey = process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY;
const parentRunId = process.env.LANGSMITH_PARENT_RUN_ID;
const endpoint = process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com';

const stopData = {
  run_id: process.env.TMCP_EVAL_RUN_ID,
  ts: new Date().toISOString(),
  transcript_path: envelope.transcript_path ?? null,
  stop_hook_active: envelope.stop_hook_active ?? null,
  last_assistant_message: envelope.last_assistant_message ?? null,
  usage: readUsage(envelope.transcript_path),
};

fs.mkdirSync(runDir, { recursive: true });
fs.writeFileSync(path.join(runDir, 'stop.json'), `${JSON.stringify(stopData, null, 2)}\n`);

if (apiKey && parentRunId) {
  try {
    await fetch(`${endpoint.replace(/\/$/, '')}/runs/${parentRunId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        extra: {
          stop_hook: stopData,
        },
      }),
    });
  } catch {
    // Hook failures should never fail the Claude Code session.
  }
}

function readUsage(transcriptPath) {
  const usage = {
    input_tokens: null,
    output_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
  };

  if (!transcriptPath) return usage;

  try {
    const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
    for (const line of lines) {
      const entry = parseJson(line);
      const entryUsage = entry?.message?.usage ?? entry?.usage;
      if (!entryUsage) continue;

      usage.input_tokens = (usage.input_tokens ?? 0) + (entryUsage.input_tokens ?? 0);
      usage.output_tokens = (usage.output_tokens ?? 0) + (entryUsage.output_tokens ?? 0);
      usage.cache_read_input_tokens =
        (usage.cache_read_input_tokens ?? 0) + (entryUsage.cache_read_input_tokens ?? 0);
      usage.cache_creation_input_tokens =
        (usage.cache_creation_input_tokens ?? 0) + (entryUsage.cache_creation_input_tokens ?? 0);
    }
  } catch {
    return usage;
  }

  return usage;
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
