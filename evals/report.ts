/**
 * Longitudinal quality report for the Tableau MCP eval suite.
 *
 * Scans every graded case (bird-result.json under evals/grades/) and rolls the
 * per-case metrics up into cohorts by (harness, normalized model) and over time,
 * emitting JSON + CSV + a Markdown summary under `evals/reports/<timestamp>/`.
 *
 * Per-case metrics reported: accuracy (verdict-derived), latency (wall_s, ttft_s),
 * cost ($), tool-call count, error count, token totals, and the four quality signals
 * (numeric/semantic/columns/filters match).
 *
 * Usage:
 *   npx tsx evals/report.ts                 # scan all grades
 *   npx tsx evals/report.ts --since 2026-07-01
 *   npx tsx evals/report.ts --harness codex --model gpt-5.6-codex
 */

/* eslint-disable no-console */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EVALS_DIR = path.join(REPO_ROOT, 'evals');
const GRADES_DIR = path.join(EVALS_DIR, 'grades');
const REPORTS_DIR = path.join(EVALS_DIR, 'reports');

const args = process.argv.slice(2);
function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
const sinceFilter = getArgValue('--since');
const harnessFilter = getArgValue('--harness');
const modelFilter = getArgValue('--model');

type BirdResult = {
  run_id: string;
  eval_run_id?: string;
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
    total_tokens: number | null;
  };
  tool_calls: number;
  llm_calls?: number;
  error_count?: number;
  signals: {
    numeric_match: boolean | null;
    semantic_match: number | null;
    columns_match: boolean | null;
    filters_match: boolean | null;
  };
  accuracy: number | null;
  verdict: string;
};

type CohortStats = {
  cohort: string;
  harness: string;
  model: string;
  n: number;
  pass: number;
  partial: number;
  fail: number;
  error: number;
  skip: number;
  grading_error: number;
  pass_rate: number | null;
  mean_accuracy: number | null;
  mean_wall_s: number | null;
  mean_ttft_s: number | null;
  total_cost_usd: number | null;
  mean_cost_usd: number | null;
  mean_tool_calls: number | null;
  total_tokens: number | null;
  total_errors: number | null;
  numeric_match_rate: number | null;
  semantic_match_rate: number | null;
  columns_match_rate: number | null;
  filters_match_rate: number | null;
  first_graded_at: string;
  last_graded_at: string;
};

// ─── Collection ─────────────────────────────────────────────────────────────

function walkBirdResults(dir: string): Array<BirdResult> {
  const out: Array<BirdResult> = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name === 'bird-result.json') {
        try {
          out.push(JSON.parse(fs.readFileSync(full, 'utf-8')) as BirdResult);
        } catch {
          // Skip malformed files.
        }
      }
    }
  }
  return out;
}

function mean(values: Array<number>): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
function sum(values: Array<number>): number {
  return values.reduce((a, b) => a + b, 0);
}
function round(value: number | null, places: number): number | null {
  if (value == null) return null;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
function rate(values: Array<boolean | null>): number | null {
  const defined = values.filter((v): v is boolean => v != null);
  return defined.length ? defined.filter(Boolean).length / defined.length : null;
}

function computeCohort(cohortKey: string, results: Array<BirdResult>): CohortStats {
  const [harness, model] = cohortKey.split('||');
  const verdicts = results.map((r) => r.verdict);
  const countVerdict = (v: string): number => verdicts.filter((x) => x === v).length;
  const graded = results.filter((r) => r.verdict !== 'grading_error').length;

  const gradedAt = results.map((r) => r.graded_at).sort();

  return {
    cohort: cohortKey,
    harness,
    model,
    n: results.length,
    pass: countVerdict('pass'),
    partial: countVerdict('partial'),
    fail: countVerdict('fail'),
    error: countVerdict('error'),
    skip: countVerdict('skip'),
    grading_error: countVerdict('grading_error'),
    pass_rate: graded > 0 ? round(countVerdict('pass') / graded, 3) : null,
    mean_accuracy: round(
      mean(results.map((r) => r.accuracy).filter((v): v is number => v != null)),
      3,
    ),
    mean_wall_s: round(mean(results.map((r) => r.wall_s).filter((v): v is number => v != null)), 1),
    mean_ttft_s: round(mean(results.map((r) => r.ttft_s).filter((v): v is number => v != null)), 1),
    total_cost_usd: round(sum(results.map((r) => r.cost_usd ?? 0)), 4),
    mean_cost_usd: round(
      mean(results.map((r) => r.cost_usd).filter((v): v is number => v != null)),
      6,
    ),
    mean_tool_calls: round(mean(results.map((r) => r.tool_calls)), 1),
    total_tokens: round(sum(results.map((r) => r.tokens?.total_tokens ?? 0)), 0),
    total_errors: round(sum(results.map((r) => r.error_count ?? 0)), 0),
    numeric_match_rate: round(rate(results.map((r) => r.signals.numeric_match)), 3),
    semantic_match_rate: round(
      mean(results.map((r) => r.signals.semantic_match).filter((v): v is number => v != null)),
      3,
    ),
    columns_match_rate: round(rate(results.map((r) => r.signals.columns_match)), 3),
    filters_match_rate: round(rate(results.map((r) => r.signals.filters_match)), 3),
    first_graded_at: gradedAt[0] ?? '',
    last_graded_at: gradedAt[gradedAt.length - 1] ?? '',
  };
}

// ─── CSV / Markdown ───────────────────────────────────────────────────────────

const COHORT_COLUMNS: Array<keyof CohortStats> = [
  'harness',
  'model',
  'n',
  'pass_rate',
  'mean_accuracy',
  'mean_wall_s',
  'mean_ttft_s',
  'total_cost_usd',
  'mean_cost_usd',
  'mean_tool_calls',
  'total_errors',
  'numeric_match_rate',
  'semantic_match_rate',
  'columns_match_rate',
  'filters_match_rate',
  'first_graded_at',
  'last_graded_at',
];

function toCsv(cohorts: Array<CohortStats>): string {
  const header = COHORT_COLUMNS.join(',');
  const rows = cohorts.map((c) =>
    COHORT_COLUMNS.map((col) => {
      const value = c[col];
      const str = value == null ? '' : String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(','),
  );
  return [header, ...rows].join('\n');
}

function toMarkdown(cohorts: Array<CohortStats>, totalCases: number): string {
  const lines: Array<string> = [];
  lines.push('# Tableau MCP Eval — Longitudinal Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Graded cases scanned: ${totalCases}`);
  if (sinceFilter) lines.push(`Since: ${sinceFilter}`);
  if (harnessFilter) lines.push(`Harness filter: ${harnessFilter}`);
  if (modelFilter) lines.push(`Model filter: ${modelFilter}`);
  lines.push('');
  lines.push('## Cohorts (harness × normalized model)');
  lines.push('');
  lines.push(
    '| Harness | Model | N | Pass rate | Accuracy | Wall (s) | TTFT (s) | Total $ | $/case | Tools/case | Errors | Semantic | Cols | Filters |',
  );
  lines.push(
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const c of cohorts) {
    lines.push(
      `| ${c.harness} | ${c.model} | ${c.n} | ${fmt(c.pass_rate)} | ${fmt(c.mean_accuracy)} | ` +
        `${fmt(c.mean_wall_s)} | ${fmt(c.mean_ttft_s)} | ${fmtMoney(c.total_cost_usd)} | ${fmtMoney(c.mean_cost_usd)} | ` +
        `${fmt(c.mean_tool_calls)} | ${c.total_errors ?? ''} | ${fmt(c.semantic_match_rate)} | ` +
        `${fmt(c.columns_match_rate)} | ${fmt(c.filters_match_rate)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function fmt(value: number | null): string {
  return value == null ? '—' : String(value);
}
function fmtMoney(value: number | null): string {
  return value == null ? '—' : `$${value}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  let results = walkBirdResults(GRADES_DIR);

  if (sinceFilter) results = results.filter((r) => r.graded_at >= sinceFilter);
  if (harnessFilter) results = results.filter((r) => (r.harness ?? '') === harnessFilter);
  if (modelFilter) {
    results = results.filter((r) => (r.model_normalized ?? r.model ?? '') === modelFilter);
  }

  if (results.length === 0) {
    console.error(
      `No graded cases found under ${GRADES_DIR}` +
        (sinceFilter || harnessFilter || modelFilter ? ' matching the given filters.' : '.'),
    );
    process.exit(1);
  }

  const cohortMap = new Map<string, Array<BirdResult>>();
  for (const r of results) {
    const key = `${r.harness ?? 'unknown'}||${r.model_normalized ?? r.model ?? 'unknown'}`;
    const bucket = cohortMap.get(key) ?? [];
    bucket.push(r);
    cohortMap.set(key, bucket);
  }

  const cohorts = [...cohortMap.entries()]
    .map(([key, rs]) => computeCohort(key, rs))
    .sort((a, b) => (b.pass_rate ?? -1) - (a.pass_rate ?? -1));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(REPORTS_DIR, stamp);
  fs.mkdirSync(outDir, { recursive: true });

  const jsonReport = {
    generated_at: new Date().toISOString(),
    filters: {
      since: sinceFilter ?? null,
      harness: harnessFilter ?? null,
      model: modelFilter ?? null,
    },
    total_cases: results.length,
    cohorts,
  };

  const jsonPath = path.join(outDir, 'longitudinal.json');
  const csvPath = path.join(outDir, 'longitudinal.csv');
  const mdPath = path.join(outDir, 'summary.md');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  fs.writeFileSync(csvPath, toCsv(cohorts));
  fs.writeFileSync(mdPath, toMarkdown(cohorts, results.length));

  console.log(
    `\nLongitudinal report over ${results.length} graded cases, ${cohorts.length} cohorts:\n`,
  );
  for (const c of cohorts) {
    console.log(
      `  ${c.harness} / ${c.model}: n=${c.n}  pass_rate=${fmt(c.pass_rate)}  ` +
        `acc=${fmt(c.mean_accuracy)}  wall=${fmt(c.mean_wall_s)}s  $=${fmtMoney(c.total_cost_usd)}  ` +
        `tools/case=${fmt(c.mean_tool_calls)}  errors=${c.total_errors ?? 0}`,
    );
  }
  console.log(`\n  JSON: ${jsonPath}`);
  console.log(`  CSV:  ${csvPath}`);
  console.log(`  MD:   ${mdPath}`);
}

main();
