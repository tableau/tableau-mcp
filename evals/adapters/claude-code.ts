/**
 * Claude Code adapter.
 *
 * Invocation (agent-under-test): `claude -p <prompt> [--model M] --mcp-config <file>
 *   --strict-mcp-config --allowedTools "ToolSearch,mcp__tableau__*"
 *   --output-format stream-json --verbose`
 * Tracing: the LangSmith Claude Code plugin, enabled via TRACE_TO_LANGSMITH +
 *   CC_LANGSMITH_* env; correlation carried in CC_LANGSMITH_METADATA.
 * Determinism (judge): CLAUDE_CODE_TEMPERATURE (verified against installed CLI docs;
 *   startup-only env var).
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

function mcpConfigPath(runDir: string): string {
  return path.join(runDir, 'mcp-config.json');
}

function baseTraceEnv(langsmith: {
  apiKey: string;
  project: string;
  endpoint: string;
}): Record<string, string> {
  return {
    TRACE_TO_LANGSMITH: 'true',
    CC_LANGSMITH_API_KEY: langsmith.apiKey,
    CC_LANGSMITH_PROJECT: langsmith.project,
    LANGSMITH_API_KEY: langsmith.apiKey,
    LANGSMITH_PROJECT: langsmith.project,
    LANGSMITH_ENDPOINT: langsmith.endpoint,
  };
}

export const claudeCodeAdapter: AgentAdapter = {
  harness: 'claude-code',

  resolveModel(requested) {
    return requested?.trim() ?? '';
  },

  writeConfig(ctx: RunContext) {
    const logsDir = path.join(ctx.runDir, 'logs');
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
    fs.writeFileSync(mcpConfigPath(ctx.runDir), JSON.stringify(mcpConfig, null, 2));
  },

  buildInvocation(ctx: RunContext): AgentInvocation {
    const metadata = buildEvalMetadata({
      runId: ctx.runId,
      suiteRunId: ctx.suiteRunId,
      harness: 'claude-code',
      model: ctx.model,
      questionId: ctx.questionId,
    });
    const args = [
      '-p',
      ctx.prompt,
      '--mcp-config',
      mcpConfigPath(ctx.runDir),
      '--strict-mcp-config',
      '--allowedTools',
      'ToolSearch,mcp__tableau__*',
      '--output-format',
      'stream-json',
      '--verbose',
    ];
    if (ctx.model) args.push('--model', ctx.model);
    return {
      command: 'claude',
      args,
      env: {
        ...baseTraceEnv(ctx.langsmith),
        CC_LANGSMITH_METADATA: JSON.stringify(metadata),
      },
      cwd: process.cwd(),
      timeoutMs: ctx.budget.maxWallMs + 10_000,
    };
  },

  buildHeadlessInvocation(ctx: HeadlessContext): AgentInvocation {
    const metadata = buildEvalMetadata({
      runId: ctx.runId,
      harness: 'claude-code',
      model: ctx.model,
      role: ctx.role,
    });
    const args = ['-p', ctx.prompt, '--output-format', 'json'];
    if (ctx.model) args.push('--model', ctx.model);
    return {
      command: 'claude',
      args,
      env: {
        ...baseTraceEnv(ctx.langsmith),
        CC_LANGSMITH_METADATA: JSON.stringify(metadata),
        CLAUDE_CODE_TEMPERATURE: String(ctx.temperature),
      },
      cwd: process.cwd(),
      timeoutMs: ctx.timeoutMs,
    };
  },

  extractFinalText(stdout: string): string {
    // Headless judge uses --output-format json → a single JSON object with `.result`.
    const trimmed = stdout.trim();
    try {
      const obj = JSON.parse(trimmed) as { result?: string; text?: string };
      if (typeof obj.result === 'string') return obj.result;
      if (typeof obj.text === 'string') return obj.text;
    } catch {
      // Fall through to stream-json line scan.
    }
    // stream-json fallback: last assistant text / result event.
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
