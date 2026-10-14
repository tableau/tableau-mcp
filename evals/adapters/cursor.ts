/**
 * Cursor CLI (`cursor-agent`) adapter.
 *
 * Invocation (agent-under-test): `cursor-agent -p <prompt> [--model M]
 *   --output-format stream-json --force --approve-mcps --trust --workspace <dir>`
 * MCP: cursor-agent discovers `.cursor/mcp.json` in the workspace dir; the adapter
 *   writes an isolated workspace per run.
 * Tracing: the LangSmith Cursor plugin, enabled via TRACE_TO_LANGSMITH +
 *   LANGSMITH_CURSOR_* env (falls back to LANGSMITH_*). Requires Node >= 22.13.
 * Determinism (judge): cursor-agent exposes NO temperature flag — the judge relies on
 *   JSON output only.
 *
 * NOTE: `cursor-agent` has no `--mcp-config` flag and no per-tool allowlist, so we
 * isolate via a per-run workspace. The custom-metadata propagation mechanism for the
 * Cursor plugin is set via env here and must be verified against the installed plugin.
 */

import * as fs from 'fs';
import * as path from 'path';

import { extractFinalTextFromStreamJson } from './streamJson.js';
import {
  AgentAdapter,
  AgentInvocation,
  buildEvalMetadata,
  buildStandardMcpConfig,
  HeadlessContext,
  RunContext,
} from './types.js';

function workspaceDir(runDir: string): string {
  return path.join(runDir, 'cursor-workspace');
}

function baseTraceEnv(
  langsmith: { apiKey: string; project: string; endpoint: string },
  metadata: Record<string, string | number>,
): Record<string, string> {
  return {
    TRACE_TO_LANGSMITH: 'true',
    LANGSMITH_CURSOR_API_KEY: langsmith.apiKey,
    LANGSMITH_CURSOR_PROJECT: langsmith.project,
    LANGSMITH_CURSOR_ENDPOINT: langsmith.endpoint,
    LANGSMITH_API_KEY: langsmith.apiKey,
    LANGSMITH_PROJECT: langsmith.project,
    LANGSMITH_ENDPOINT: langsmith.endpoint,
    // Best-effort correlation channel (verify against installed Cursor plugin).
    LANGSMITH_CURSOR_METADATA: JSON.stringify(metadata),
  };
}

export const cursorAdapter: AgentAdapter = {
  harness: 'cursor',

  resolveModel(requested) {
    return requested?.trim() ?? '';
  },

  writeConfig(ctx: RunContext) {
    const ws = workspaceDir(ctx.runDir);
    const cursorDir = path.join(ws, '.cursor');
    const logsDir = path.join(ctx.runDir, 'logs');
    fs.mkdirSync(cursorDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    const mcpConfig = buildStandardMcpConfig(ctx);
    fs.writeFileSync(path.join(cursorDir, 'mcp.json'), JSON.stringify(mcpConfig, null, 2));
  },

  buildInvocation(ctx: RunContext): AgentInvocation {
    const metadata = buildEvalMetadata({
      runId: ctx.runId,
      suiteRunId: ctx.suiteRunId,
      harness: 'cursor',
      model: ctx.model,
      questionId: ctx.questionId,
    });
    const ws = workspaceDir(ctx.runDir);
    const args = [
      '-p',
      ctx.prompt,
      '--output-format',
      'stream-json',
      '--force',
      '--approve-mcps',
      '--trust',
      '--workspace',
      ws,
    ];
    if (ctx.model) args.push('--model', ctx.model);
    return {
      command: 'cursor-agent',
      args,
      env: baseTraceEnv(ctx.langsmith, metadata),
      cwd: process.cwd(),
      timeoutMs: ctx.budget.maxWallMs + 10_000,
    };
  },

  buildHeadlessInvocation(ctx: HeadlessContext): AgentInvocation {
    const metadata = buildEvalMetadata({
      runId: ctx.runId,
      harness: 'cursor',
      model: ctx.model,
      role: ctx.role,
    });
    // No MCP tools for the judge; ask/read-only mode keeps it from taking actions.
    const args = ['-p', ctx.prompt, '--output-format', 'json', '--mode', 'ask'];
    if (ctx.model) args.push('--model', ctx.model);
    return {
      command: 'cursor-agent',
      args,
      env: baseTraceEnv(ctx.langsmith, metadata),
      cwd: process.cwd(),
      timeoutMs: ctx.timeoutMs,
    };
  },

  extractFinalText(stdout: string): string {
    return extractFinalTextFromStreamJson(stdout);
  },
};
