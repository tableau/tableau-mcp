/**
 * Batch grader for a completed BIRD suite run.
 *
 * Grades every case in a suite run and writes a single suite-grade.json
 * to evals/grades/YYYY-MM-DD/<suite-run-id>/.
 *
 * Usage:
 *   npx tsx evals/grade-suite.ts evals/suite-runs/YYYY-MM-DD/<suite-run-id>
 *   npx tsx evals/grade-suite.ts           # auto-discovers most recent suite run
 *
 * Optional environment:
 *   GRADER_HARNESS    — coding-agent harness for the semantic_match judge (default claude-code);
 *                       verdict degrades to numeric-only if no usable harness is available
 *   GRADER_MODEL      — override the judge harness model (default: the harness's own default)
 */

/* eslint-disable no-console */

import { execFileSync } from 'child_process';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const EVALS_DIR = path.join(REPO_ROOT, 'evals');
const SUITE_RUNS_DIR = path.join(EVALS_DIR, 'suite-runs');
const GRADES_DIR = path.join(EVALS_DIR, 'grades');
const GRADE_BIRD_SCRIPT = path.join(EVALS_DIR, 'grade-bird.ts');

function dateSlug(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SuiteSummary = {
  suite_run_id: string;
  suite_file: string;
  started_at: string;
  finished_at: string;
  total_wall_ms: number;
  harness?: string | null;
  model?: string | null;
  cases: Array<{
    question_id: number;
    difficulty: string;
    run_id: string;
    run_dir: string;
    exit_code: number | null;
    wall_ms: number | null;
    timed_out: boolean;
    error: string | null;
  }>;
};

type BirdResult = {
  run_id: string;
  eval_run_id: string;
  question_id: number;
  difficulty: string;
  graded_at: string;
  harness: string | null;
  model: string | null;
  model_normalized: string | null;
  wall_s: number | null;
  ttft_s: number | null;
  cost_usd: number | null;
  tokens: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
    total_tokens: number | null;
  };
  tool_calls: number;
  tools_used: Array<string>;
  llm_calls: number;
  error_count: number;
  signals: {
    numeric_match: boolean | null;
    semantic_match: number | null;
    columns_match: boolean | null;
    filters_match: boolean | null;
  };
  accuracy: number | null;
  verdict: 'pass' | 'partial' | 'fail' | 'error' | 'skip' | 'grading_error';
};

type CaseGrade = {
  question_id: number;
  difficulty: string;
  run_id: string;
  verdict: BirdResult['verdict'];
  numeric_match: boolean | null;
  semantic_match: number | null;
  columns_match: boolean | null;
  filters_match: boolean | null;
  accuracy: number | null;
  harness: string | null;
  model: string | null;
  model_normalized: string | null;
  wall_s: number | null;
  ttft_s: number | null;
  cost_usd: number | null;
  tool_calls: number;
  tools_used: Array<string>;
  llm_calls: number | null;
  error_count: number | null;
  tokens: BirdResult['tokens'] | null;
  grade_file: string | null;
  grading_error: string | null;
};

// ─── Discovery ────────────────────────────────────────────────────────────────

function findMostRecentSuiteRunDir(): string {
  const allSummaries: Array<{ mtime: number; dir: string }> = [];

  for (const entry of fs.readdirSync(SUITE_RUNS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(SUITE_RUNS_DIR, entry.name);

    // Support both flat (legacy) and date-nested layouts
    const candidates = [
      sub,
      ...fs
        .readdirSync(sub, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(sub, e.name)),
    ];

    for (const dir of candidates) {
      const summaryPath = path.join(dir, 'suite-summary.json');
      if (fs.existsSync(summaryPath)) {
        allSummaries.push({ mtime: fs.statSync(summaryPath).mtimeMs, dir });
      }
    }
  }

  if (allSummaries.length === 0) {
    console.error(`No suite runs found under ${SUITE_RUNS_DIR}`);
    process.exit(1);
  }

  allSummaries.sort((a, b) => b.mtime - a.mtime);
  return allSummaries[0].dir;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const suiteRunDirArg = process.argv[2];
  const suiteRunDir = suiteRunDirArg ? path.resolve(suiteRunDirArg) : findMostRecentSuiteRunDir();

  const summaryPath = path.join(suiteRunDir, 'suite-summary.json');
  if (!fs.existsSync(summaryPath)) {
    console.error(`suite-summary.json not found in: ${suiteRunDir}`);
    process.exit(1);
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as SuiteSummary;
  const { suite_run_id, cases } = summary;
  const today = dateSlug();

  console.log(`\nGrading suite: ${suite_run_id}`);
  console.log(`Cases:         ${cases.length}`);
  console.log(`Run dir:       ${suiteRunDir}\n`);

  const caseGrades: Array<CaseGrade> = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const label = `Q${c.question_id} (${c.difficulty}) [${i + 1}/${cases.length}]`;
    process.stdout.write(`  ${label.padEnd(32)}`);

    // Derive where grade-bird.ts will write its output
    const gradeFile = path.join(GRADES_DIR, today, c.run_id, 'bird-result.json');

    let gradeResult: BirdResult | null = null;
    let gradingError: string | null = null;

    try {
      execFileSync('npx', ['tsx', GRADE_BIRD_SCRIPT, c.run_dir], {
        env: process.env,
        cwd: REPO_ROOT,
        stdio: 'pipe',
      });
      if (fs.existsSync(gradeFile)) {
        gradeResult = JSON.parse(fs.readFileSync(gradeFile, 'utf-8')) as BirdResult;
      } else {
        gradingError = 'bird-result.json not found after grading';
      }
    } catch (err: unknown) {
      const e = err as { message?: string; stderr?: Buffer };
      gradingError = e.stderr?.toString().trim() || e.message || 'unknown grading error';
    }

    const verdict = gradeResult?.verdict ?? 'grading_error';
    const verdictLabel =
      verdict === 'pass'
        ? '✓ PASS'
        : verdict === 'partial'
          ? '~ PARTIAL'
          : verdict === 'fail'
            ? '✗ FAIL'
            : verdict === 'error'
              ? '! ERROR'
              : verdict === 'skip'
                ? '- SKIP'
                : '? GRADING_ERROR';

    process.stdout.write(`${verdictLabel}\n`);

    caseGrades.push({
      question_id: c.question_id,
      difficulty: c.difficulty,
      run_id: c.run_id,
      verdict,
      numeric_match: gradeResult?.signals.numeric_match ?? null,
      semantic_match: gradeResult?.signals.semantic_match ?? null,
      columns_match: gradeResult?.signals.columns_match ?? null,
      filters_match: gradeResult?.signals.filters_match ?? null,
      accuracy: gradeResult?.accuracy ?? null,
      harness: gradeResult?.harness ?? null,
      model: gradeResult?.model ?? null,
      model_normalized: gradeResult?.model_normalized ?? null,
      wall_s: gradeResult?.wall_s ?? null,
      ttft_s: gradeResult?.ttft_s ?? null,
      cost_usd: gradeResult?.cost_usd ?? null,
      tool_calls: gradeResult?.tool_calls ?? 0,
      tools_used: gradeResult?.tools_used ?? [],
      llm_calls: gradeResult?.llm_calls ?? null,
      error_count: gradeResult?.error_count ?? null,
      tokens: gradeResult?.tokens ?? null,
      grade_file: gradeResult ? gradeFile : null,
      grading_error: gradingError,
    });
  }

  // ── Aggregate stats ──────────────────────────────────────────────────────────

  const counts = {
    pass: caseGrades.filter((g) => g.verdict === 'pass').length,
    partial: caseGrades.filter((g) => g.verdict === 'partial').length,
    fail: caseGrades.filter((g) => g.verdict === 'fail').length,
    error: caseGrades.filter((g) => g.verdict === 'error').length,
    skip: caseGrades.filter((g) => g.verdict === 'skip').length,
    grading_error: caseGrades.filter((g) => g.verdict === 'grading_error').length,
  };
  const total = caseGrades.length;
  const passRate = total > 0 ? counts.pass / total : 0;

  const mean = (values: Array<number>): number | null =>
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const sum = (values: Array<number>): number => values.reduce((a, b) => a + b, 0);

  const accuracyValues = caseGrades.map((g) => g.accuracy).filter((v): v is number => v != null);
  const wallValues = caseGrades.map((g) => g.wall_s).filter((v): v is number => v != null);
  const ttftValues = caseGrades.map((g) => g.ttft_s).filter((v): v is number => v != null);
  const costValues = caseGrades.map((g) => g.cost_usd).filter((v): v is number => v != null);
  const toolCallValues = caseGrades.map((g) => g.tool_calls);
  const errorValues = caseGrades.map((g) => g.error_count).filter((v): v is number => v != null);

  const suiteGrade = {
    suite_run_id,
    suite_file: summary.suite_file,
    suite_started_at: summary.started_at,
    suite_finished_at: summary.finished_at,
    graded_at: new Date().toISOString(),
    harness: summary.harness ?? caseGrades.find((g) => g.harness)?.harness ?? null,
    model: caseGrades.find((g) => g.model_normalized)?.model_normalized ?? summary.model ?? null,
    summary: {
      total,
      pass: counts.pass,
      partial: counts.partial,
      fail: counts.fail,
      error: counts.error,
      skip: counts.skip,
      grading_error: counts.grading_error,
      pass_rate: Math.round(passRate * 1000) / 1000,
    },
    metrics: {
      mean_accuracy: accuracyValues.length
        ? Math.round((mean(accuracyValues) ?? 0) * 1000) / 1000
        : null,
      mean_wall_s: wallValues.length ? Math.round((mean(wallValues) ?? 0) * 10) / 10 : null,
      mean_ttft_s: ttftValues.length ? Math.round((mean(ttftValues) ?? 0) * 10) / 10 : null,
      total_cost_usd: costValues.length ? Math.round(sum(costValues) * 1e4) / 1e4 : null,
      mean_cost_usd: costValues.length ? Math.round((mean(costValues) ?? 0) * 1e6) / 1e6 : null,
      mean_tool_calls: toolCallValues.length
        ? Math.round((mean(toolCallValues) ?? 0) * 10) / 10
        : null,
      total_errors: errorValues.length ? sum(errorValues) : null,
    },
    cases: caseGrades,
  };

  const gradeOutDir = path.join(GRADES_DIR, today, suite_run_id);
  fs.mkdirSync(gradeOutDir, { recursive: true });
  const suiteGradePath = path.join(gradeOutDir, 'suite-grade.json');
  fs.writeFileSync(suiteGradePath, JSON.stringify(suiteGrade, null, 2));

  // ── Print summary ─────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════');
  console.log(`Suite grade: ${suite_run_id}`);
  console.log(`  Harness/model: ${suiteGrade.harness ?? '?'} / ${suiteGrade.model ?? '?'}`);
  console.log(`  Pass rate: ${counts.pass}/${total} (${(passRate * 100).toFixed(1)}%)`);
  console.log(
    `  pass=${counts.pass}  partial=${counts.partial}  fail=${counts.fail}` +
      `  error=${counts.error}  skip=${counts.skip}` +
      (counts.grading_error > 0 ? `  grading_error=${counts.grading_error}` : ''),
  );
  const m = suiteGrade.metrics;
  console.log(
    `  accuracy=${m.mean_accuracy ?? '?'}  mean_wall=${m.mean_wall_s ?? '?'}s  ` +
      `mean_ttft=${m.mean_ttft_s ?? '?'}s  total_cost=${m.total_cost_usd != null ? `$${m.total_cost_usd}` : '?'}  ` +
      `mean_tools=${m.mean_tool_calls ?? '?'}  errors=${m.total_errors ?? '?'}`,
  );
  console.log(`  Grade file: ${suiteGradePath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
