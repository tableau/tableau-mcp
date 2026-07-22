/**
 * Agent harness abstraction for the Tableau MCP eval harness.
 *
 * An `AgentAdapter` encapsulates everything agent-specific about invoking a
 * coding-agent CLI: the command + argv (including the model flag), the MCP
 * server config in the agent's own format, and the environment that enables the
 * official LangSmith coding-agent tracing plugin. Adapters do NOT post traces or
 * compute grades — the plugin traces automatically and the grader reads the trace
 * back from LangSmith (single source of truth).
 */

export type AgentHarness = 'claude-code' | 'cursor' | 'codex';

export const AGENT_HARNESSES: ReadonlyArray<AgentHarness> = ['claude-code', 'cursor', 'codex'];

export function isAgentHarness(value: string | undefined): value is AgentHarness {
  return value != null && (AGENT_HARNESSES as ReadonlyArray<string>).includes(value);
}

/** A fully-formed CLI invocation the runner can hand to `execFileSync`. */
export type AgentInvocation = {
  command: string;
  args: Array<string>;
  env: Record<string, string>;
  cwd: string;
  timeoutMs: number;
};

/** Result of spawning an agent CLI (persisted verbatim for debugging only). */
export type AgentResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** LangSmith connection + correlation shared by every invocation. */
export type LangSmithConfig = {
  apiKey: string;
  project: string;
  endpoint: string;
};

/** Context for a full agent-under-test run (with MCP tools attached). */
export type RunContext = {
  runId: string;
  suiteRunId: string | null;
  runDir: string;
  prompt: string;
  /** Resolved model id ('' means "let the CLI use its default"). */
  model: string;
  mcpServerEntry: string;
  mcpServerEnv: Record<string, string>;
  questionId: number | null;
  langsmith: LangSmithConfig;
  budget: { maxWallMs: number; maxToolCalls: number };
};

/** Context for a headless one-shot prompt (no MCP tools) — e.g. the grader judge. */
export type HeadlessContext = {
  runId: string;
  runDir: string;
  prompt: string;
  model: string;
  /** 0 for deterministic judging; applied only where the CLI supports it. */
  temperature: number;
  /** Attribution role for trace metadata, e.g. 'judge'. */
  role: string;
  langsmith: LangSmithConfig;
  timeoutMs: number;
};

export interface AgentAdapter {
  readonly harness: AgentHarness;

  /** Resolve the model to use: the requested id, or the adapter's default (''=CLI default). */
  resolveModel(requested: string | undefined): string;

  /**
   * Write any per-run config files the CLI needs (MCP server config in the
   * agent's own format). Called before `buildInvocation`.
   */
  writeConfig(ctx: RunContext): void;

  /** Build the CLI invocation for a full agent-under-test run (MCP tools attached). */
  buildInvocation(ctx: RunContext): AgentInvocation;

  /**
   * Build the CLI invocation for a headless one-shot prompt with no MCP tools,
   * requesting structured/JSON-friendly output. Used by the grader's judge.
   */
  buildHeadlessInvocation(ctx: HeadlessContext): AgentInvocation;

  /** Extract the final assistant text from this agent's raw stdout. */
  extractFinalText(stdout: string): string;
}

/** Build the `coding-agent` custom metadata blob shared across adapters. */
export function buildEvalMetadata(ctx: {
  runId: string;
  suiteRunId?: string | null;
  harness: AgentHarness;
  model: string;
  questionId?: number | null;
  role?: string;
}): Record<string, string | number> {
  const meta: Record<string, string | number> = {
    eval_run_id: ctx.runId,
    harness: ctx.harness,
  };
  if (ctx.suiteRunId) meta.suite_run_id = ctx.suiteRunId;
  if (ctx.model) meta.model = ctx.model;
  if (ctx.questionId != null) meta.question_id = ctx.questionId;
  if (ctx.role) meta.eval_role = ctx.role;
  return meta;
}
