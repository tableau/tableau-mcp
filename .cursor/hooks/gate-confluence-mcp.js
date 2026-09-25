#!/usr/bin/env node
'use strict';

/**
 * gate-confluence-mcp.js — beforeMCPExecution gate for Confluence writes.
 *
 * Runs via dispatch.js in-process (exports.run) or as its own process (the CLI
 * block at the bottom, still used by Claude Code and by hand).
 *
 * Hard-blocks create/update outside the MARTECH + MTT allowlist. Comments → ask (no spaceId on tool).
 * Non-Confluence MCP always allow. Identified write + stdin parse fail → deny.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  isConfluenceWriteTool,
  evaluateConfluenceWrite,
} = require('./lib/confluence-space-gate.js');
const { parseHookStdinJson, readStdinBuffer } = require('./lib/hook-stdin.js');

const AUDIT_LOG = path.join(os.homedir(), '.cursor', 'confluence-mcp-audit.jsonl');

function appendAudit(entry) {
  try {
    const dir = path.dirname(AUDIT_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(AUDIT_LOG, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.error(`confluence-mcp audit log failed: ${err.message}`);
  }
}

/**
 * The whole decision, with the audit write as its only side effect. Shared by
 * the dispatcher and the CLI so both paths gate identically.
 *
 * @param {{argvTool?: string, payload?: object, payloadOk?: boolean,
 *          payloadError?: string}} input
 */
function decide(input) {
  const argvTool = input.argvTool || '';

  if (input.payloadOk === false) {
    const isWrite = isConfluenceWriteTool(argvTool);
    appendAudit({
      timestamp: new Date().toISOString(),
      source: 'cursor',
      decision: isWrite ? 'deny' : 'allow',
      reason: isWrite ? 'stdin_parse_failed_fail_closed_write' : 'stdin_parse_failed_allow_non_write',
      error: input.payloadError,
      argvTool,
    });
    if (!isWrite) return { permission: 'allow' };
    return {
      permission: 'deny',
      agent_message:
        'gate-confluence-mcp: could not parse MCP stdin for a Confluence write — denied (fail closed)',
    };
  }

  const payload = input.payload || {};
  const toolName = String(payload.tool_name || payload.toolName || argvTool || '');
  const toolInput = payload.tool_input !== undefined ? payload.tool_input : payload.arguments;

  const result = evaluateConfluenceWrite(toolName, toolInput);
  appendAudit({
    timestamp: new Date().toISOString(),
    source: 'cursor',
    decision: result.decision,
    reason: result.reason,
    toolName,
  });

  if (result.decision === 'allow') return { permission: 'allow' };
  if (result.decision === 'ask') {
    return { permission: 'ask', user_message: result.reason, agent_message: result.reason };
  }
  return { permission: 'deny', agent_message: result.reason };
}

/** A thrown gate must not become an accidental allow on a write. */
function resultForFatal(argvTool) {
  if (!isConfluenceWriteTool(argvTool)) return { permission: 'allow' };
  return {
    permission: 'deny',
    agent_message:
      'gate-confluence-mcp: fatal error during Confluence write evaluation — denied (fail closed)',
  };
}

/** Dispatcher entry point. */
function run(context) {
  const args = (context && context.args) || [];
  const argvTool = args[1] || args[0] || '';
  try {
    return decide({
      argvTool,
      payload: (context && context.payload) || {},
      payloadOk: context ? context.payloadOk !== false : true,
      payloadError: context && context.payloadError,
    });
  } catch (err) {
    console.error(`gate-confluence-mcp fatal: ${err.message}`);
    return resultForFatal(argvTool);
  }
}

module.exports = { run, decide, resultForFatal };

if (require.main === module) {
  const argvTool = process.argv[3] || process.argv[2] || '';
  (async () => {
    const parsed = parseHookStdinJson(await readStdinBuffer());
    const result = decide({
      argvTool,
      payload: parsed.ok ? parsed.value : {},
      payloadOk: parsed.ok,
      payloadError: parsed.ok ? null : parsed.error,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  })().catch((err) => {
    console.error(`gate-confluence-mcp fatal: ${err.message}`);
    process.stdout.write(`${JSON.stringify(resultForFatal(argvTool))}\n`);
    process.exit(0);
  });
}
