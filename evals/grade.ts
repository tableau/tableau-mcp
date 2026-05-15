/**
 * Local grader for Claude Code + LangSmith eval runs.
 *
 * Usage:
 *   npx tsx evals/grade.ts evals/runs/<run_id>
 */

/* eslint-disable no-console */

import * as fs from 'fs';
import * as path from 'path';

const runDir = process.argv[2];
if (!runDir) {
  console.error('Usage: npx tsx evals/grade.ts <run-dir>');
  process.exit(1);
}

type RunMeta = {
  run_id: string;
  case_id: string;
  expected_tools?: Array<string>;
  budget: {
    max_tool_calls: number;
    max_wall_ms: number;
  };
  wall_ms?: number;
  claude_exit_code?: number;
  timed_out?: boolean;
  langsmith?: {
    project: string;
    endpoint: string;
    parent_run_id: string;
  };
};

type HookRecord = {
  tool_name?: string;
  normalized_tool_name?: string;
  langsmith_run_id?: string;
};

type ChildPost = {
  ok?: boolean;
  status?: number;
  tool_name?: string;
};

const absRunDir = path.resolve(runDir);
const runMeta = JSON.parse(fs.readFileSync(path.join(absRunDir, 'run.json'), 'utf-8')) as RunMeta;
const hookRecords = readJsonl<HookRecord>(path.join(absRunDir, 'hook.jsonl'));
const childPosts = readJsonl<ChildPost>(path.join(absRunDir, 'langsmith-child-runs.jsonl'));
const stop = readOptionalJson(path.join(absRunDir, 'stop.json'));

const observedTools = hookRecords
  .map((record) => normalizeToolName(record.normalized_tool_name ?? record.tool_name ?? ''))
  .filter(Boolean);
const expectedTools = runMeta.expected_tools ?? [];
const missingTools = expectedTools.filter(
  (tool) => !observedTools.includes(normalizeToolName(tool)),
);
const failedLangSmithPosts = childPosts.filter((post) => post.ok === false);

type Outcome = 'pass' | 'fail' | 'timeout' | 'budget_exceeded' | 'error';

function deriveOutcome(): Outcome {
  if (runMeta.timed_out) return 'timeout';
  if (runMeta.claude_exit_code != null && runMeta.claude_exit_code !== 0) return 'error';
  if (hookRecords.length > runMeta.budget.max_tool_calls) return 'budget_exceeded';
  if (missingTools.length > 0 || failedLangSmithPosts.length > 0) return 'fail';
  return 'pass';
}

const result = {
  run_id: runMeta.run_id,
  case_id: runMeta.case_id,
  graded_at: new Date().toISOString(),
  outcome: deriveOutcome(),
  langsmith: runMeta.langsmith ?? null,
  expected_tools: expectedTools,
  observed_tools: observedTools,
  missing_tools: missingTools,
  tool_calls: hookRecords.length,
  langsmith_child_posts: {
    total: childPosts.length,
    failed: failedLangSmithPosts.length,
    statuses: childPosts.map((post) => post.status).filter((status) => status != null),
  },
  wall_ms: runMeta.wall_ms ?? null,
  budget: runMeta.budget,
  stop,
};

const resultPath = path.join(absRunDir, 'result.json');
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));

console.log(`\nGrade: ${runMeta.run_id}`);
console.log(`Outcome:      ${result.outcome.toUpperCase()}`);
console.log(`Tool calls:   ${result.tool_calls} (budget: ${runMeta.budget.max_tool_calls})`);
console.log(`Expected:     ${expectedTools.length ? expectedTools.join(', ') : 'n/a'}`);
console.log(`Observed:     ${observedTools.length ? observedTools.join(', ') : 'none'}`);
console.log(`Missing:      ${missingTools.length ? missingTools.join(', ') : 'none'}`);
console.log(
  `LangSmith:    ${childPosts.length - failedLangSmithPosts.length}/${childPosts.length} child posts ok`,
);
console.log(`Result:       ${resultPath}`);

function readJsonl<T>(filePath: string): Array<T> {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((value): value is T => value !== null);
}

function readOptionalJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function normalizeToolName(toolName: string): string {
  const parts = toolName.split('__');
  const raw = parts[parts.length - 1] || toolName;
  return raw.replace(/^tableau_/, '').replace(/^tableau-/, '');
}
