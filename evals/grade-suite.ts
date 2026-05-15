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
 *   OPENAI_API_KEY    — enables semantic_match (LLM judge); verdict degrades to numeric-only without it
 *   BIRD_GRADE_MODEL  — override LLM judge model (default: gpt-4o-mini)
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
  cases: Array<{
    question_id: number;
    difficulty: string;
    run_id: string;
    run_dir: string;
    exit_code: number | null;
    wall_ms: number | null;
    timed_out: boolean;
    tool_calls: number;
    tools_used: Array<string>;
    tokens: {
      input: number | null;
      output: number | null;
      cache_read: number | null;
      cache_creation: number | null;
    };
    error: string | null;
  }>;
  aggregate: {
    total_cases: number;
    completed: number;
    errored: number;
    timed_out: number;
    avg_wall_ms: number | null;
    total_input_tokens: number;
    total_output_tokens: number;
  };
};

type BirdResult = {
  run_id: string;
  question_id: number;
  difficulty: string;
  graded_at: string;
  model: string | null;
  wall_s: number | null;
  tokens: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
    total_context_tokens: number | null;
  };
  tool_calls: number;
  tools_used: Array<string>;
  signals: {
    numeric_match: boolean | null;
    semantic_match: number | null;
    columns_match: boolean | null;
    filters_match: boolean | null;
  };
  verdict: 'pass' | 'partial' | 'fail' | 'error' | 'skip';
};

type CaseGrade = {
  question_id: number;
  difficulty: string;
  run_id: string;
  verdict: BirdResult['verdict'] | 'grading_error';
  numeric_match: boolean | null;
  semantic_match: number | null;
  columns_match: boolean | null;
  filters_match: boolean | null;
  model: string | null;
  wall_s: number | null;
  tool_calls: number;
  tools_used: Array<string>;
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
    const candidates = [sub, ...fs.readdirSync(sub, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(sub, e.name))];

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
  const suiteRunDir = suiteRunDirArg
    ? path.resolve(suiteRunDirArg)
    : findMostRecentSuiteRunDir();

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
    const verdictLabel = verdict === 'pass' ? '✓ PASS'
      : verdict === 'partial' ? '~ PARTIAL'
      : verdict === 'fail' ? '✗ FAIL'
      : verdict === 'error' ? '! ERROR'
      : verdict === 'skip' ? '- SKIP'
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
      model: gradeResult?.model ?? null,
      wall_s: gradeResult?.wall_s ?? null,
      tool_calls: gradeResult?.tool_calls ?? c.tool_calls,
      tools_used: gradeResult?.tools_used ?? c.tools_used,
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

  const suiteGrade = {
    suite_run_id,
    suite_file: summary.suite_file,
    suite_started_at: summary.started_at,
    suite_finished_at: summary.finished_at,
    graded_at: new Date().toISOString(),
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
    cases: caseGrades,
  };

  const gradeOutDir = path.join(GRADES_DIR, today, suite_run_id);
  fs.mkdirSync(gradeOutDir, { recursive: true });
  const suiteGradePath = path.join(gradeOutDir, 'suite-grade.json');
  fs.writeFileSync(suiteGradePath, JSON.stringify(suiteGrade, null, 2));

  // ── Print summary ─────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════');
  console.log(`Suite grade: ${suite_run_id}`);
  console.log(
    `  Pass rate: ${counts.pass}/${total} (${(passRate * 100).toFixed(1)}%)`,
  );
  console.log(
    `  pass=${counts.pass}  partial=${counts.partial}  fail=${counts.fail}` +
      `  error=${counts.error}  skip=${counts.skip}` +
      (counts.grading_error > 0 ? `  grading_error=${counts.grading_error}` : ''),
  );
  console.log(`  Grade file: ${suiteGradePath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
