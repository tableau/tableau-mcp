/**
 * OpenAI Codex CLI adapter.
 *
 * Invocation (agent-under-test): `codex exec --json -m <model> -C <cwd>
 *   --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox <prompt>`
 * MCP: configured via `[mcp_servers.tableau]` in an isolated `$CODEX_HOME/config.toml`.
 * Tracing: the LangSmith Codex plugin, enabled via TRACE_TO_LANGSMITH +
 *   LANGSMITH_CODEX_* env (falls back to LANGSMITH_*); plugin hooks live in config.toml.
 * Determinism (judge): `-c temperature=0` (reasoning models may ignore it; JSON output
 *   is the primary stability mechanism).
 *
 * We set CODEX_HOME to a per-run directory so the tableau MCP config and plugin
 * settings never touch the user's global ~/.codex. The exact plugin-metadata wiring
 * must be verified against the installed Codex LangSmith plugin.
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

function codexHome(runDir: string): string {
  return path.join(runDir, 'codex-home');
}

function tomlString(value: string): string {
  return JSON.stringify(value); // TOML basic strings share JSON escaping for our inputs.
}

function tomlStringArray(values: Array<string>): string {
  return `[${values.map(tomlString).join(', ')}]`;
}

/** Render a minimal config.toml with an optional MCP server + env table. */
function renderConfigToml(opts: { mcp?: { entry: string; env: Record<string, string> } }): string {
  const lines: Array<string> = [];
  if (opts.mcp) {
    lines.push('[mcp_servers.tableau]');
    lines.push(`command = ${tomlString('node')}`);
    lines.push(`args = ${tomlStringArray([opts.mcp.entry])}`);
    lines.push('');
    lines.push('[mcp_servers.tableau.env]');
    for (const [k, v] of Object.entries(opts.mcp.env)) {
      lines.push(`${k} = ${tomlString(v)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function baseTraceEnv(
  runDir: string,
  langsmith: { apiKey: string; project: string; endpoint: string },
  metadata: Record<string, string | number>,
): Record<string, string> {
  const home = codexHome(runDir);
  fs.mkdirSync(home, { recursive: true });
  // Best-effort correlation channel (verify against installed Codex plugin).
  fs.writeFileSync(
    path.join(home, 'langsmith.json'),
    JSON.stringify({ enabled: true, project: langsmith.project, metadata }, null, 2),
  );
  return {
    CODEX_HOME: home,
    TRACE_TO_LANGSMITH: 'true',
    LANGSMITH_CODEX_API_KEY: langsmith.apiKey,
    LANGSMITH_CODEX_PROJECT: langsmith.project,
    LANGSMITH_CODEX_ENDPOINT: langsmith.endpoint,
    LANGSMITH_API_KEY: langsmith.apiKey,
    LANGSMITH_PROJECT: langsmith.project,
    LANGSMITH_ENDPOINT: langsmith.endpoint,
    LANGSMITH_CODEX_METADATA: JSON.stringify(metadata),
  };
}

export const codexAdapter: AgentAdapter = {
  harness: 'codex',

  resolveModel(requested) {
    return requested?.trim() ?? '';
  },

  writeConfig(ctx: RunContext) {
    const home = codexHome(ctx.runDir);
    const logsDir = path.join(ctx.runDir, 'logs');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    const toml = renderConfigToml({
      mcp: {
        entry: ctx.mcpServerEntry,
        env: {
          ...ctx.mcpServerEnv,
          TRANSPORT: 'stdio',
          FILE_LOGGER_DIRECTORY: logsDir,
          ENABLED_LOGGERS: 'fileLogger',
        },
      },
    });
    fs.writeFileSync(path.join(home, 'config.toml'), toml);
  },

  buildInvocation(ctx: RunContext): AgentInvocation {
    const metadata = buildEvalMetadata({
      runId: ctx.runId,
      suiteRunId: ctx.suiteRunId,
      harness: 'codex',
      model: ctx.model,
      questionId: ctx.questionId,
    });
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      process.cwd(),
    ];
    if (ctx.model) args.push('-m', ctx.model);
    args.push(ctx.prompt);
    return {
      command: 'codex',
      args,
      env: baseTraceEnv(ctx.runDir, ctx.langsmith, metadata),
      cwd: process.cwd(),
      timeoutMs: ctx.budget.maxWallMs + 10_000,
    };
  },

  buildHeadlessInvocation(ctx: HeadlessContext): AgentInvocation {
    const home = codexHome(ctx.runDir);
    fs.mkdirSync(home, { recursive: true });
    // Empty config (no MCP servers) for the judge.
    fs.writeFileSync(path.join(home, 'config.toml'), renderConfigToml({}));
    const metadata = buildEvalMetadata({
      runId: ctx.runId,
      harness: 'codex',
      model: ctx.model,
      role: ctx.role,
    });
    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-c',
      `temperature=${ctx.temperature}`,
      '-C',
      ctx.runDir,
    ];
    if (ctx.model) args.push('-m', ctx.model);
    args.push(ctx.prompt);
    return {
      command: 'codex',
      args,
      env: baseTraceEnv(ctx.runDir, ctx.langsmith, metadata),
      cwd: ctx.runDir,
      timeoutMs: ctx.timeoutMs,
    };
  },

  extractFinalText(stdout: string): string {
    const lines = stdout
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    let lastText = '';
    for (const line of lines) {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      // Tolerate several codex event shapes across versions.
      const item = ev.item as { text?: string; item_type?: string; type?: string } | undefined;
      const msg = ev.msg as { type?: string; message?: string } | undefined;
      if (item && typeof item.text === 'string' && item.text.trim()) {
        lastText = item.text;
      } else if (msg && typeof msg.message === 'string' && msg.message.trim()) {
        lastText = msg.message;
      } else if (typeof ev.message === 'string' && (ev.message as string).trim()) {
        lastText = ev.message as string;
      } else if (typeof ev.text === 'string' && (ev.text as string).trim()) {
        lastText = ev.text as string;
      }
    }
    return lastText || stdout.trim();
  },
};
