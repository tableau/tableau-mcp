#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook.
 *
 * Records the exact timestamp when each tool call is dispatched so that
 * the PostToolUse hook can compute true tool execution latency rather than
 * approximating it from the previous hook record.
 *
 * Writes one record per tool call to pre-tool-times.jsonl in the run directory.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import fs from 'fs';
import path from 'path';

const input = await readStdin();
const envelope = parseJson(input);

if (!envelope) {
  process.exit(0);
}

const now = new Date().toISOString();
const runDir = process.env.TMCP_EVAL_RUN_DIR;

if (runDir && envelope.tool_use_id) {
  const preToolTimesPath = path.join(runDir, 'pre-tool-times.jsonl');
  appendJsonl(preToolTimesPath, {
    ts: now,
    tool_use_id: envelope.tool_use_id,
    tool_name: envelope.tool_name ?? null,
  });
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
