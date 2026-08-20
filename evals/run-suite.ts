/**
 * Suite runner for the BIRD California Schools eval.
 *
 * Runs all 30 cases (or a filtered subset) sequentially against the live
 * Tableau MCP server. Each case is executed via run-case.ts, so agent selection
 * (AGENT_HARNESS/AGENT_MODEL) and LangSmith plugin tracing are identical to ad-hoc
 * runs. Per-case quality/latency/cost/token metrics are NOT collected here — they are
 * sourced from the LangSmith trace at grading time (grade-suite.ts).
 *
 * Usage:
 *   npx tsx evals/run-suite.ts
 *   npx tsx evals/run-suite.ts --suite evals/suites/bird-california-schools.json
 *   npx tsx evals/run-suite.ts --difficulty simple
 *   npx tsx evals/run-suite.ts --ids 5,11,12
 *   npx tsx evals/run-suite.ts --agent-harness codex --agent-model gpt-5.6-codex
 *
 * Required environment: same as run-case.ts (Tableau auth + LANGSMITH_API_KEY).
 * Set EVAL_DATASOURCE_LUID to the LUID of the published California Schools datasource.
 */

/* eslint-disable no-console */

import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { getAdapter, resolveHarness } from './adapters/index.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const EVALS_DIR = path.join(REPO_ROOT, 'evals');
const RUNS_DIR = path.join(EVALS_DIR, 'runs');
const SUITE_RUNS_DIR = path.join(EVALS_DIR, 'suite-runs');

function dateSlug(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const DEFAULT_SUITE = path.join(EVALS_DIR, 'suites', 'bird-california-schools.json');

const args = process.argv.slice(2);

function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const suiteFile = getArgValue('--suite') ?? DEFAULT_SUITE;
const difficultyFilter = getArgValue('--difficulty');
const idsFilter = getArgValue('--ids')
  ?.split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter(Number.isFinite);

const harness = resolveHarness(getArgValue('--agent-harness'), 'AGENT_HARNESS');
const model = getAdapter(harness).resolveModel(
  getArgValue('--agent-model') ?? process.env.AGENT_MODEL,
);

type BirdCase = {
  question_id: number;
  question: string;
  evidence: string;
  difficulty: string;
  answer_type: 'scalar' | 'list';
  expected_value: number | string | null;
  expected_row_count: number | null;
  ai_summarized_answer: string;
  expected_columns: Array<string>;
  expected_filter_fields: Array<string>;
  prompt: string;
  expected_tools: Array<string>;
  budget: { max_wall_ms: number };
};

type EvalCaseFile = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  expected_tools: Array<string>;
  tags: Array<string>;
  metadata: Record<string, unknown>;
  budget: { max_wall_ms: number };
};

type CaseRunResult = {
  question_id: number;
  difficulty: string;
  run_id: string;
  run_dir: string;
  eval_run_id: string;
  exit_code: number | null;
  wall_ms: number | null;
  timed_out: boolean;
  error: string | null;
};

function readOptionalJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function buildEvalCaseFile(birdCase: BirdCase, absoluteSuitePath: string): EvalCaseFile {
  return {
    id: `bird-ca-schools-${birdCase.question_id}`,
    name: `BIRD California Schools Q${birdCase.question_id}`,
    description: birdCase.question,
    prompt: birdCase.prompt,
    expected_tools: birdCase.expected_tools,
    tags: ['bird', 'california-schools', birdCase.difficulty],
    metadata: {
      question_id: birdCase.question_id,
      difficulty: birdCase.difficulty,
      suite: 'bird-california-schools',
      suite_file: absoluteSuitePath,
    },
    budget: birdCase.budget,
  };
}

function collectRunMetrics(runDir: string): Omit<CaseRunResult, 'question_id' | 'difficulty'> {
  const runMeta = readOptionalJson<{
    run_id: string;
    eval_run_id?: string;
    wall_ms?: number;
    agent_exit_code?: number;
    timed_out?: boolean;
    error?: string | null;
  }>(path.join(runDir, 'run.json'));
  const runId = path.basename(runDir);
  return {
    run_id: runMeta?.run_id ?? runId,
    run_dir: runDir,
    eval_run_id: runMeta?.eval_run_id ?? runMeta?.run_id ?? runId,
    exit_code: runMeta?.agent_exit_code ?? null,
    wall_ms: runMeta?.wall_ms ?? null,
    timed_out: runMeta?.timed_out ?? false,
    error: runMeta?.error ?? null,
  };
}

function main(): void {
  if (!fs.existsSync(suiteFile)) {
    console.error(`Suite file not found: ${suiteFile}`);
    process.exit(1);
  }

  if (!process.env.EVAL_DATASOURCE_LUID) {
    console.error(
      'EVAL_DATASOURCE_LUID must be set to the LUID of the published datasource to evaluate against.',
    );
    process.exit(1);
  }

  const allCases = JSON.parse(fs.readFileSync(suiteFile, 'utf-8')) as Array<BirdCase>;

  let cases = allCases;
  if (difficultyFilter) {
    cases = cases.filter((c) => c.difficulty === difficultyFilter);
    console.log(`Filtered to difficulty="${difficultyFilter}": ${cases.length} cases`);
  }
  if (idsFilter?.length) {
    cases = cases.filter((c) => idsFilter.includes(c.question_id));
    console.log(`Filtered to ids=${idsFilter.join(',')}: ${cases.length} cases`);
  }

  if (cases.length === 0) {
    console.error('No cases matched the filters.');
    process.exit(1);
  }

  const today = dateSlug();
  const suiteRunId = `bird-ca-schools-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const suiteRunDir = path.join(SUITE_RUNS_DIR, today, suiteRunId);
  const casesDir = path.join(suiteRunDir, 'cases');
  fs.mkdirSync(casesDir, { recursive: true });
  fs.mkdirSync(path.join(RUNS_DIR, today), { recursive: true });

  const absoluteSuitePath = path.resolve(suiteFile);
  const startedAt = new Date().toISOString();

  console.log(`\nSuite run:       ${suiteRunId}`);
  console.log(`Suite:           ${suiteFile}`);
  console.log(`Cases:           ${cases.length}`);
  console.log(`Harness / model: ${harness} / ${model || '(cli default)'}`);
  console.log(`Run dir:         ${suiteRunDir}\n`);

  const runCaseScript = path.join(EVALS_DIR, 'run-case.ts');
  const results: Array<CaseRunResult> = [];

  for (let i = 0; i < cases.length; i++) {
    const birdCase = cases[i];
    const caseLabel = `Q${birdCase.question_id} (${birdCase.difficulty}) [${i + 1}/${cases.length}]`;
    console.log(`\n─── ${caseLabel} ───`);
    console.log(
      `    ${birdCase.question.slice(0, 80)}${birdCase.question.length > 80 ? '...' : ''}`,
    );

    const evalCaseFile = buildEvalCaseFile(birdCase, absoluteSuitePath);
    const caseFilePath = path.join(casesDir, `case-${birdCase.question_id}.json`);
    fs.writeFileSync(caseFilePath, JSON.stringify(evalCaseFile, null, 2));

    const runId = `${evalCaseFile.id}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const runDir = path.join(RUNS_DIR, today, runId);

    const budgetSec = Math.round(birdCase.budget.max_wall_ms / 1000);
    process.stdout.write(`    Running ${harness} (up to ${budgetSec}s)...`);

    const runCaseArgs = [
      'tsx',
      runCaseScript,
      caseFilePath,
      '--run-id',
      runId,
      '--suite-run-id',
      suiteRunId,
      '--agent-harness',
      harness,
    ];
    if (model) runCaseArgs.push('--agent-model', model);

    let spawnError: string | null = null;
    try {
      execFileSync('npx', runCaseArgs, {
        env: process.env,
        cwd: REPO_ROOT,
        timeout: birdCase.budget.max_wall_ms + 30_000,
        stdio: 'pipe',
      });
    } catch (error: unknown) {
      const e = error as { message?: string };
      spawnError = e.message ?? 'unknown spawn error';
    }
    process.stdout.write(' done\n');

    const metrics = collectRunMetrics(runDir);
    results.push({
      question_id: birdCase.question_id,
      difficulty: birdCase.difficulty,
      ...metrics,
      error: metrics.error ?? spawnError,
    });

    const status =
      metrics.exit_code === 0 ? 'OK' : metrics.timed_out ? 'TIMEOUT' : `EXIT ${metrics.exit_code}`;
    console.log(
      `    ${status} | ${metrics.wall_ms != null ? `${Math.round(metrics.wall_ms / 1000)}s` : '?s'}`,
    );
  }

  const finishedAt = new Date().toISOString();
  const totalWallMs = results.reduce((sum, r) => sum + (r.wall_ms ?? 0), 0);
  const completed = results.filter((r) => r.exit_code === 0).length;
  const errored = results.filter((r) => r.exit_code !== 0 && !r.timed_out).length;
  const timedOut = results.filter((r) => r.timed_out).length;
  const avgWall =
    results.filter((r) => r.wall_ms != null).length > 0
      ? Math.round(totalWallMs / results.filter((r) => r.wall_ms != null).length)
      : null;

  const summary = {
    suite_run_id: suiteRunId,
    suite_file: absoluteSuitePath,
    started_at: startedAt,
    finished_at: finishedAt,
    harness,
    model: model || null,
    total_wall_ms: totalWallMs,
    cases: results,
    aggregate: {
      total_cases: results.length,
      completed,
      errored,
      timed_out: timedOut,
      avg_wall_ms: avgWall,
    },
  };

  const summaryPath = path.join(suiteRunDir, 'suite-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n═══════════════════════════════════════');
  console.log(`Suite complete: ${suiteRunId}`);
  console.log(`  ${completed}/${results.length} OK | ${errored} error | ${timedOut} timeout`);
  console.log(`  Total wall time: ${(totalWallMs / 1000).toFixed(1)}s`);
  console.log(`  Summary: ${summaryPath}`);
  console.log('\nTo grade the whole suite (sources metrics from LangSmith traces):');
  console.log(`  npx tsx ${path.join(EVALS_DIR, 'grade-suite.ts')} ${suiteRunDir}`);
}

main();
