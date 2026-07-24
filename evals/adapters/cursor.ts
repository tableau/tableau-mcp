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

import {
  AgentAdapter,
  AgentInvocation,
  buildEvalMetadata,
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
    const mcpConfig = {
      mcpServers: {
        tableau: {
          command: 'node',
          args: [ctx.mcpServerEntry],
          env: {
            ...ctx.mcpServerEnv,
            TRANSPORT: 'stdio',
            FILE_LOGGER_DIRECTORY: logsDir,
            ENABLED_LOGGERS: 'fileLogger',
          },
        },
      },
    };
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
    const trimmed = stdout.trim();
    // `--output-format json` → single object; try direct parse first.
    try {
      const obj = JSON.parse(trimmed) as {
        result?: string;
        text?: string;
        message?: { content?: Array<{ type?: string; text?: string }> | string };
      };
      if (typeof obj.result === 'string') return obj.result;
      if (typeof obj.text === 'string') return obj.text;
    } catch {
      // Fall through to JSONL scan.
    }
    const lines = trimmed.split('\n').filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i]) as {
          type?: string;
          result?: string;
          message?: { content?: Array<{ type?: string; text?: string }> | string };
        };
        if (ev.type === 'result' && typeof ev.result === 'string') return ev.result;
        const content = ev.message?.content;
        if (Array.isArray(content)) {
          const text = content
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text)
            .join('\n');
          if (text) return text;
        } else if (typeof content === 'string' && content.trim()) {
          return content;
        }
      } catch {
        continue;
      }
    }
    return trimmed;
  },
};
