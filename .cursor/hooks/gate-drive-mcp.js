#!/usr/bin/env node
'use strict';

/**
 * gate-drive-mcp.js — beforeMCPExecution gate for Google Drive MCP.
 *
 * Runs via dispatch.js in-process (exports.run) or as its own process (the CLI
 * block at the bottom, still used by Claude Code and by hand).
 *
 * Ask on update_file / trash_file / copy_file / share_file.
 * Allow create_file and reads. Non-Drive MCP always allow.
 * Identified Drive mutate + stdin parse fail → ask (not deny; named-this-turn
 * still needs a human card). failClosed stays off on the shared MCP entry.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  isDriveSurface,
  isDriveAskTool,
  evaluateDriveMutate,
} = require('./lib/drive-mutate-gate.js');
const { parseHookStdinJson, readStdinBuffer } = require('./lib/hook-stdin.js');

const AUDIT_LOG = path.join(os.homedir(), '.cursor', 'drive-mcp-audit.jsonl');

function appendAudit(entry) {
  try {
    const dir = path.dirname(AUDIT_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(AUDIT_LOG, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.error(`drive-mcp audit log failed: ${err.message}`);
  }
}

function ask(reason) {
  return { permission: 'ask', user_message: reason, agent_message: reason };
}

/**
 * The whole decision, with the audit write as its only side effect. Shared by
 * the dispatcher and the CLI so both paths gate identically.
 *
 * @param {{argvServer?: string, argvTool?: string, payload?: object,
 *          payloadOk?: boolean, payloadError?: string}} input
 */
function decide(input) {
  const argvServer = input.argvServer || '';
  const argvTool = input.argvTool || '';

  if (input.payloadOk === false) {
    const driveAsk = isDriveSurface(argvServer, argvTool) && isDriveAskTool(argvTool);
    appendAudit({
      timestamp: new Date().toISOString(),
      source: 'cursor',
      decision: driveAsk ? 'ask' : 'allow',
      reason: driveAsk ? 'stdin_parse_failed_ask_drive_mutate' : 'stdin_parse_failed_allow_non_drive',
      error: input.payloadError,
      argvServer,
      argvTool,
    });
    if (driveAsk) {
      return ask(
        'gate-drive-mcp: could not parse MCP stdin for a Drive mutate — ask Andy (fail closed to human)'
      );
    }
    return { permission: 'allow' };
  }

  const payload = input.payload || {};
  const toolName = String(payload.tool_name || payload.toolName || argvTool || '');
  const toolInput = payload.tool_input !== undefined ? payload.tool_input : payload.arguments;
  const server = String(payload.server || payload.mcp_server || payload.command || argvServer || '');

  const result = evaluateDriveMutate(toolName, toolInput, server);
  appendAudit({
    timestamp: new Date().toISOString(),
    source: 'cursor',
    decision: result.decision,
    reason: result.reason,
    toolName,
    server,
  });

  return result.decision === 'ask' ? ask(result.reason) : { permission: 'allow' };
}

/** Dispatcher entry point. */
function run(context) {
  const args = (context && context.args) || [];
  return decide({
    argvServer: args[0] || '',
    argvTool: args[1] || args[0] || '',
    payload: (context && context.payload) || {},
    payloadOk: context ? context.payloadOk !== false : true,
    payloadError: context && context.payloadError,
  });
}

module.exports = { run, decide };

if (require.main === module) {
  (async () => {
    const parsed = parseHookStdinJson(await readStdinBuffer());
    const result = decide({
      argvServer: process.argv[2] || '',
      argvTool: process.argv[3] || process.argv[2] || '',
      payload: parsed.ok ? parsed.value : {},
      payloadOk: parsed.ok,
      payloadError: parsed.ok ? null : parsed.error,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  })().catch((err) => {
    console.error(`gate-drive-mcp fatal: ${err.message}`);
    process.stdout.write(`${JSON.stringify({ permission: 'allow' })}\n`);
    process.exit(0);
  });
}
