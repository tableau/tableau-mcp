#!/usr/bin/env node
'use strict';

/**
 * gate-browser-mcp.js — beforeMCPExecution gate for browser navigate + mutate.
 *
 * Runs via dispatch.js in-process (exports.run) or as its own process (the CLI
 * block at the bottom, still used by Claude Code and by hand).
 *
 * Hybrid navigate policy (deny > allow > ask). Mutate/evaluate_script: deny
 * session-exfil patterns; else ask. Forces position:active on IDE navigate allow/ask.
 * Non-browser MCP (wiki, Slack, etc.) always allow — never deny on stdin quirks.
 *
 * Input: stdin JSON { tool_name, tool_input, ... } (Cursor hook contract).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  loadPolicy,
  classifyBrowserCall,
  withForcedVisiblePosition,
  isBrowserNavigateCall,
} = require('./lib/browser-host-classify.js');
const { classifyBrowserMutateCall } = require('./lib/browser-mutate-classify.js');
const { parseHookStdinJson, readStdinBuffer } = require('./lib/hook-stdin.js');
const { isVisitedAllowHost, findWikiRoot } = require('./lib/browser-visited-allow.js');

const AUDIT_LOG = path.join(os.homedir(), '.cursor', 'browser-mcp-audit.jsonl');
const POLICY_PATH = path.join(__dirname, 'browser-domain-policy.json');
const WIKI_ROOT = findWikiRoot(path.join(__dirname, '..', '..')) || findWikiRoot(process.cwd());

function appendAudit(entry) {
  try {
    const dir = path.dirname(AUDIT_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(AUDIT_LOG, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.error(`browser-mcp audit log failed: ${err.message}`);
  }
}

const ALLOW = { permission: 'allow' };

/**
 * @param {string} server
 * @param {string} toolName
 * @param {{ decision: string, reason?: string, url?: string|null, host?: string|null }} result
 * @param {unknown} toolInput
 * @param {boolean} forceVisible
 */
function gatedResult(server, toolName, result, toolInput, forceVisible) {
  const decision = result.decision || 'ask';
  appendAudit({
    timestamp: new Date().toISOString(),
    source: 'cursor',
    server,
    tool: toolName,
    url: result.url || null,
    host: result.host || null,
    decision,
    reason: result.reason || null,
  });
  console.error(
    `BROWSER GATE: decision=${decision} tool=${toolName} host=${result.host || '?'} url=${result.url || '?'}`
  );

  /** @type {Record<string, unknown>} */
  const out = {
    permission: decision,
    user_message: result.reason,
    agent_message: `${result.reason} Do not bypass via raw CDP/Playwright.`,
  };

  if (forceVisible && (decision === 'allow' || decision === 'ask')) {
    const updated = withForcedVisiblePosition(toolInput);
    if (updated) {
      out.updated_input = updated;
      out.updatedInput = updated;
      out.agent_message += ' Keep the browser visible (position: active).';
    } else {
      out.agent_message +=
        ' Could not rewrite tool input — you MUST pass position: "active" on browser_navigate.';
    }
  }

  return out;
}

/**
 * The whole decision, with audit writes as its only side effect. Shared by the
 * dispatcher and the CLI so both paths gate identically.
 *
 * @param {{argvServer?: string, argvTool?: string, payload?: object,
 *          payloadOk?: boolean, payloadError?: string, rawPreview?: string}} input
 */
function decide(input) {
  const argvServer = input.argvServer || '';
  const argvTool = input.argvTool || '';

  if (input.payloadOk === false) {
    appendAudit({
      timestamp: new Date().toISOString(),
      source: 'cursor',
      decision: 'allow',
      reason: 'stdin_parse_failed_allow_non_browser',
      error: input.payloadError,
      preview: input.rawPreview,
      argvTool,
    });
    console.error(
      `BROWSER GATE: stdin parse failed — allowing (non-browser safe): ${input.payloadError}`
    );
    return ALLOW;
  }

  const payload = input.payload || {};
  const toolName = String(payload.tool_name || payload.toolName || argvTool || '');
  const toolInput = payload.tool_input !== undefined ? payload.tool_input : payload.arguments;
  const server = String(payload.command || payload.url || argvServer || 'cursor-ide-browser');

  const mutate = classifyBrowserMutateCall(toolName, toolInput);
  if (mutate.gated) return gatedResult(server, toolName, mutate, toolInput, false);

  if (!isBrowserNavigateCall(toolName, toolInput)) return ALLOW;

  let policy;
  try {
    policy = loadPolicy(POLICY_PATH);
    policy.isVisitedAllow = (host) => isVisitedAllowHost(host, WIKI_ROOT);
  } catch (err) {
    appendAudit({
      timestamp: new Date().toISOString(),
      source: 'cursor',
      decision: 'deny',
      reason: 'policy_load_failed',
      error: err.message,
      tool: toolName,
    });
    return {
      permission: 'deny',
      user_message: 'Browser domain policy missing or invalid (fail-closed for navigate).',
      agent_message: `gate-browser-mcp: policy load failed: ${err.message}`,
    };
  }

  const result = classifyBrowserCall(toolName, toolInput, policy);
  if (!result.gated) return ALLOW;
  return gatedResult(server, toolName, result, toolInput, true);
}

function auditFatal(message) {
  appendAudit({
    timestamp: new Date().toISOString(),
    source: 'cursor',
    decision: 'allow',
    reason: 'fatal_allow',
    error: message,
  });
}

/** Dispatcher entry point. */
function run(context) {
  const args = (context && context.args) || [];
  try {
    return decide({
      argvServer: args[0] || '',
      argvTool: args[1] || '',
      payload: (context && context.payload) || {},
      payloadOk: context ? context.payloadOk !== false : true,
      payloadError: context && context.payloadError,
    });
  } catch (err) {
    console.error(`gate-browser-mcp fatal: ${err.message}`);
    auditFatal(err.message);
    return ALLOW;
  }
}

module.exports = { run, decide };

if (require.main === module) {
  (async () => {
    const parsed = parseHookStdinJson(await readStdinBuffer());
    const result = decide({
      argvServer: process.argv[2] || '',
      argvTool: process.argv[3] || '',
      payload: parsed.ok ? parsed.value : {},
      payloadOk: parsed.ok,
      payloadError: parsed.ok ? null : parsed.error,
      rawPreview: parsed.rawPreview,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  })().catch((err) => {
    console.error(`gate-browser-mcp fatal: ${err.message}`);
    process.stdout.write(`${JSON.stringify(ALLOW)}\n`);
    auditFatal(err.message);
    process.exit(0);
  });
}
