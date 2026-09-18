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

import { extractFinalTextFromStreamJson } from './streamJson.js';
import {
  AgentAdapter,
  AgentInvocation,
  buildEvalMetadata,
  buildStandardMcpConfig,
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
    const mcpConfig = buildStandardMcpConfig(ctx);
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
    return extractFinalTextFromStreamJson(stdout);
  },
};
