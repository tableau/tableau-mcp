/**
 * Ad hoc grader for coding-agent + LangSmith eval runs.
 *
 * Tool coverage is sourced from the LangSmith trace (by `eval_run_id`), not local
 * artifacts. Grades tool coverage + budget/timeout/exit only; use grade-bird.ts for
 * answer-quality grading.
 *
 * Usage:
 *   npx tsx evals/grade.ts evals/runs/<date>/<run_id>
 */

/* eslint-disable no-console */

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { fetchTraceSummary, makeClient, normalizeToolName } from './langsmith-reader.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const runDir = process.argv[2];
if (!runDir) {
  console.error('Usage: npx tsx evals/grade.ts <run-dir>');
  process.exit(1);
}

type RunMeta = {
  run_id: string;
  case_id: string;
  eval_run_id?: string;
  harness?: string;
  model?: string | null;
  langsmith_project?: string;
  expected_tools?: Array<string>;
  // run-case.ts writes these camelCase (maxToolCalls/maxWallMs). Snake_case is
  // accepted only for backward-compat with older run.json artifacts.
  budget: {
    maxToolCalls?: number;
    maxWallMs?: number;
    max_tool_calls?: number;
    max_wall_ms?: number;
  };
  wall_ms?: number;
  agent_exit_code?: number;
  timed_out?: boolean;
};

type Outcome =
  | 'pass'
  | 'fail'
  | 'timeout'
  | 'budget_exceeded'
  | 'error'
  | 'tool_error'
  | 'grading_error';

const absRunDir = path.resolve(runDir);
const runMeta = JSON.parse(fs.readFileSync(path.join(absRunDir, 'run.json'), 'utf-8')) as RunMeta;

async function main(): Promise<void> {
  const evalRunId = runMeta.eval_run_id ?? runMeta.run_id;
  const projectName =
    runMeta.langsmith_project ?? process.env.LANGSMITH_PROJECT ?? 'tableau-mcp-evals';

  const client = makeClient();
  const summary = await fetchTraceSummary(client, {
    projectName,
    evalRunId,
    pollIntervalMs: Number(process.env.GRADE_TRACE_POLL_MS ?? 5_000),
    timeoutMs: Number(process.env.GRADE_TRACE_TIMEOUT_MS ?? 60_000),
  });

  const expectedTools = runMeta.expected_tools ?? [];
  const observedTools = summary ? [...new Set(summary.toolCalls.map((t) => t.normalizedName))] : [];
  const toolCalls = summary?.toolCalls.length ?? 0;
  const missingTools = expectedTools.filter(
    (tool) => !observedTools.includes(normalizeToolName(tool)),
  );

  // A tool that was invoked but returned an error must not count as coverage: an
  // expected call that the admin gate (or any API error) rejected would otherwise
  // still satisfy `observed ⊇ expected` and pass. Flag any errored call whose
  // normalized name is an expected tool.
  const expectedNormalized = new Set(expectedTools.map((t) => normalizeToolName(t)));
  const erroredExpectedTools = summary
    ? [
        ...new Set(
          summary.toolCalls
            .filter(
              (t) => t.error != null && t.error !== '' && expectedNormalized.has(t.normalizedName),
            )
            .map((t) => t.normalizedName),
        ),
      ]
    : [];

  const maxToolCalls = runMeta.budget.maxToolCalls ?? runMeta.budget.max_tool_calls;

  const outcome: Outcome = (() => {
    if (!summary) return 'grading_error';
    if (runMeta.timed_out) return 'timeout';
    if (runMeta.agent_exit_code != null && runMeta.agent_exit_code !== 0) return 'error';
    if (maxToolCalls != null && toolCalls > maxToolCalls) return 'budget_exceeded';
    if (missingTools.length > 0) return 'fail';
    if (erroredExpectedTools.length > 0) return 'tool_error';
    return 'pass';
  })();

  const result = {
    run_id: runMeta.run_id,
    case_id: runMeta.case_id,
    eval_run_id: evalRunId,
    graded_at: new Date().toISOString(),
    outcome,
    harness: runMeta.harness ?? null,
    model: summary?.model ?? runMeta.model ?? null,
    langsmith_project: projectName,
    trace_id: summary?.traceId ?? null,
    expected_tools: expectedTools,
    observed_tools: observedTools,
    missing_tools: missingTools,
    tool_calls: toolCalls,
    llm_calls: summary?.llmRunCount ?? null,
    cost_usd: summary?.costUsd ?? null,
    wall_ms: runMeta.wall_ms ?? summary?.wallMs ?? null,
    budget: runMeta.budget,
    trace_error: summary
      ? null
      : `No LangSmith trace found for eval_run_id=${evalRunId} in project "${projectName}".`,
  };

  const resultPath = path.join(absRunDir, 'result.json');
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));

  console.log(`\nGrade: ${runMeta.run_id}`);
  console.log(`Outcome:      ${result.outcome.toUpperCase()}`);
  console.log(`Harness:      ${result.harness ?? 'n/a'} / ${result.model ?? 'n/a'}`);
  console.log(`Tool calls:   ${result.tool_calls} (budget: ${maxToolCalls ?? 'n/a'})`);
  console.log(`Expected:     ${expectedTools.length ? expectedTools.join(', ') : 'n/a'}`);
  console.log(`Observed:     ${observedTools.length ? observedTools.join(', ') : 'none'}`);
  console.log(`Missing:      ${missingTools.length ? missingTools.join(', ') : 'none'}`);
  if (result.trace_error) console.log(`Trace:        ${result.trace_error}`);
  console.log(`Result:       ${resultPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
