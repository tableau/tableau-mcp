/**
 * BIRD-specific grader for California Schools eval runs — trace-sourced.
 *
 * All per-case signals are derived from the coding-agent trace in LangSmith
 * (fetched by `eval_run_id`), not from local artifacts. Signals:
 *   columns_match   — required VizQL fields present in a query-datasource tool call
 *   filters_match   — required filter fields present in a query-datasource tool call
 *   numeric_match   — expected value / row count found in the agent's final message
 *   semantic_match  — LLM judge (run via GRADER_HARNESS/GRADER_MODEL, headless)
 *
 * Usage:
 *   npx tsx evals/grade-bird.ts evals/runs/<date>/<run-id>
 *
 * Required environment:
 *   LANGSMITH_API_KEY (or LANGCHAIN_API_KEY), LANGSMITH_PROJECT (fallback for older runs)
 * Optional:
 *   GRADER_HARNESS=claude-code|cursor|codex (default claude-code), GRADER_MODEL=<model>
 *   GRADE_TRACE_TIMEOUT_MS (default 60000), GRADE_TRACE_POLL_MS (default 5000)
 */

/* eslint-disable no-console */

import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import { getAdapter, HeadlessContext, resolveHarness } from './adapters/index.js';
import { extractJsonObject, runHeadless } from './adapters/run-headless.js';
import { fetchTraceSummary, findVizqlQuery, makeClient, TraceSummary } from './langsmith-reader.js';
import { normalizeModel } from './model-normalize.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const EVALS_DIR = path.join(REPO_ROOT, 'evals');
const GRADES_DIR = path.join(EVALS_DIR, 'grades');

function dateSlug(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const runDirArg = process.argv[2];
if (!runDirArg) {
  console.error('Usage: npx tsx evals/grade-bird.ts <run-dir>');
  process.exit(1);
}
const absRunDir = path.resolve(runDirArg);

// ─── Types ───────────────────────────────────────────────────────────────────

type RunMeta = {
  run_id: string;
  case_id: string;
  eval_run_id?: string;
  harness?: string;
  model?: string | null;
  langsmith_project?: string;
  wall_ms?: number;
  agent_exit_code?: number;
  timed_out?: boolean;
  metadata?: {
    question_id?: number;
    difficulty?: string;
    suite_file?: string;
  };
};

type VizqlField = { fieldCaption?: string };
type VizqlFilter = { field?: { fieldCaption?: string } };
type VizqlQuery = { fields?: Array<VizqlField>; filters?: Array<VizqlFilter> };

type BirdCase = {
  question_id: number;
  question: string;
  difficulty: string;
  answer_type: 'scalar' | 'list';
  expected_value: number | string | null;
  expected_row_count: number | null;
  ai_summarized_answer: string;
  expected_columns: Array<string>;
  expected_filter_fields: Array<string>;
};

type LlmJudgeResult = { correct: boolean; score: number; reason: string };

type BirdGradeResult = {
  run_id: string;
  eval_run_id: string;
  question_id: number;
  difficulty: string;
  graded_at: string;
  harness: string | null;
  model: string | null;
  model_normalized: string | null;
  grader_harness: string;
  grader_model: string | null;
  // Latency / cost / volume metrics (from trace).
  wall_s: number | null;
  ttft_s: number | null;
  cost_usd: number | null;
  cost_source: TraceSummary['costSource'] | 'n/a';
  tokens: {
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
    total_tokens: number | null;
  };
  tool_calls: number;
  tools_used: Array<string>;
  llm_calls: number;
  subagent_count: number;
  error_count: number;
  // Quality signals.
  signals: {
    numeric_match: boolean | null;
    semantic_match: number | null;
    columns_match: boolean | null;
    filters_match: boolean | null;
  };
  accuracy: number | null;
  details: {
    expected_columns: Array<string>;
    actual_columns: Array<string>;
    missing_columns: Array<string>;
    expected_filter_fields: Array<string>;
    actual_filter_fields: Array<string>;
    missing_filter_fields: Array<string>;
    expected_value: number | string | null;
    expected_row_count: number | null;
    extracted_number: number | null;
    final_message_preview: string;
    llm_judge: LlmJudgeResult | null;
    llm_judge_error: string | null;
    trace_error: string | null;
  };
  verdict: 'pass' | 'partial' | 'fail' | 'error' | 'skip' | 'grading_error';
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readOptionalJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function collectFieldCaptions(fields: Array<VizqlField> | undefined): Array<string> {
  return (fields ?? [])
    .map((f) => f.fieldCaption ?? '')
    .filter(Boolean)
    .map((c) => c.toLowerCase());
}

function collectFilterCaptions(filters: Array<VizqlFilter> | undefined): Array<string> {
  return (filters ?? [])
    .map((f) => f.field?.fieldCaption ?? '')
    .filter(Boolean)
    .map((c) => c.toLowerCase());
}

function extractMatchingNumber(text: string, expected: number | string | null): number | null {
  if (expected === null) return null;
  let expectedNum: number | null = null;
  if (typeof expected === 'number') {
    expectedNum = expected;
  } else {
    const parsed = parseFloat(String(expected).replace(/,/g, ''));
    if (!isNaN(parsed)) expectedNum = parsed;
  }
  if (expectedNum === null) return null;

  const clean = text.replace(/,/g, '');
  const matches = clean.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const candidates = matches.map((m) => parseFloat(m)).filter((n) => !isNaN(n));

  const isClose = (a: number, b: number): boolean => {
    if (b === 0) return Math.abs(a) < 0.001;
    return Math.abs(a - b) / Math.abs(b) <= 0.01 || Math.abs(a - b) <= 0.001;
  };
  const percentageCandidates = candidates.map((n) => n / 100);
  for (const candidate of [...candidates, ...percentageCandidates]) {
    if (isClose(candidate, expectedNum)) return candidate;
  }
  return null;
}

function checkNumericMatch(
  finalMessage: string,
  birdCase: BirdCase,
): { matched: boolean; extracted: number | null } {
  const target =
    birdCase.answer_type === 'scalar' ? birdCase.expected_value : birdCase.expected_row_count;
  if (target === null) return { matched: false, extracted: null };
  if (typeof target === 'string') {
    return { matched: finalMessage.toLowerCase().includes(target.toLowerCase()), extracted: null };
  }
  const extracted = extractMatchingNumber(finalMessage, target);
  return { matched: extracted !== null, extracted };
}

// ─── LLM Judge (via GRADER_HARNESS) ────────────────────────────────────────────

function runJudge(
  birdCase: BirdCase,
  finalMessage: string,
): {
  result: LlmJudgeResult | null;
  error: string | null;
  harness: string;
  model: string | null;
} {
  const graderHarness = resolveHarness(undefined, 'GRADER_HARNESS');
  const adapter = getAdapter(graderHarness);
  const graderModel = adapter.resolveModel(process.env.GRADER_MODEL);

  const targetValue =
    birdCase.answer_type === 'scalar'
      ? `Expected value: ${String(birdCase.expected_value)}`
      : `Expected row count: ${String(birdCase.expected_row_count)}`;

  const prompt = [
    'You are evaluating whether an AI agent correctly answered a data question about California schools.',
    '',
    `Question: ${birdCase.question}`,
    '',
    `Gold answer summary: ${birdCase.ai_summarized_answer}`,
    `${targetValue}`,
    '',
    "Agent's response:",
    finalMessage.slice(0, 3000),
    '',
    "Does the agent's response correctly answer the question?",
    'Consider:',
    '- Numeric values must match (allow rounding/formatting differences, e.g. "90.5%" and "0.905" are the same)',
    '- The agent must address the right entities (not a proxy or wrong dimension)',
    '- Partial credit if the agent got the right approach but a slightly wrong number',
    '',
    'Respond with a single JSON object and nothing else:',
    '{"correct": true|false, "score": 0.0-1.0, "reason": "one sentence"}',
  ].join('\n');

  const judgeDir = path.join(absRunDir, 'judge');
  fs.mkdirSync(judgeDir, { recursive: true });

  const ctx: HeadlessContext = {
    runId: `${path.basename(absRunDir)}-judge`,
    runDir: judgeDir,
    prompt,
    model: graderModel,
    temperature: 0,
    role: 'judge',
    langsmith: {
      apiKey: process.env.LANGSMITH_API_KEY ?? process.env.LANGCHAIN_API_KEY ?? '',
      project: process.env.LANGSMITH_PROJECT ?? 'tableau-mcp-evals',
      endpoint: process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com',
    },
    timeoutMs: Number(process.env.GRADE_JUDGE_TIMEOUT_MS ?? 120_000),
  };

  const outcome = runHeadless(adapter, ctx);
  if (outcome.exitCode !== 0 && !outcome.text) {
    return {
      result: null,
      error: `judge exited ${outcome.exitCode}: ${outcome.stderr}`,
      harness: graderHarness,
      model: graderModel || null,
    };
  }
  const parsed = extractJsonObject<Partial<LlmJudgeResult>>(outcome.text);
  if (!parsed) {
    return {
      result: null,
      error: `could not parse judge JSON from output: ${outcome.text.slice(0, 200)}`,
      harness: graderHarness,
      model: graderModel || null,
    };
  }
  return {
    result: {
      correct: parsed.correct ?? false,
      score: typeof parsed.score === 'number' ? parsed.score : parsed.correct ? 1.0 : 0.0,
      reason: parsed.reason ?? '',
    },
    error: null,
    harness: graderHarness,
    model: graderModel || null,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function writeResult(result: BirdGradeResult): string {
  const gradeDir = path.join(GRADES_DIR, dateSlug(), result.run_id);
  fs.mkdirSync(gradeDir, { recursive: true });
  const resultPath = path.join(gradeDir, 'bird-result.json');
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  return resultPath;
}

async function main(): Promise<void> {
  const runMeta = readOptionalJson<RunMeta>(path.join(absRunDir, 'run.json'));
  if (!runMeta) {
    console.error(`run.json not found in ${absRunDir}`);
    process.exit(1);
  }

  const questionId = runMeta.metadata?.question_id;
  const suiteFilePath = runMeta.metadata?.suite_file;
  if (!questionId || !suiteFilePath) {
    console.error(
      'run.json is missing metadata.question_id or metadata.suite_file.\n' +
        'This grader only works on runs produced by run-suite.ts.',
    );
    process.exit(1);
  }
  if (!fs.existsSync(suiteFilePath)) {
    console.error(`Suite file not found: ${suiteFilePath}`);
    process.exit(1);
  }

  const suite = JSON.parse(fs.readFileSync(suiteFilePath, 'utf-8')) as Array<BirdCase>;
  const birdCase = suite.find((c) => c.question_id === questionId);
  if (!birdCase) {
    console.error(`Question ID ${questionId} not found in suite file.`);
    process.exit(1);
  }

  const runId = runMeta.run_id ?? path.basename(absRunDir);
  const evalRunId = runMeta.eval_run_id ?? runId;
  const projectName =
    runMeta.langsmith_project ?? process.env.LANGSMITH_PROJECT ?? 'tableau-mcp-evals';
  const difficulty = runMeta.metadata?.difficulty ?? birdCase.difficulty ?? 'unknown';

  const baseResult: BirdGradeResult = {
    run_id: runId,
    eval_run_id: evalRunId,
    question_id: questionId,
    difficulty,
    graded_at: new Date().toISOString(),
    harness: runMeta.harness ?? null,
    model: runMeta.model ?? null,
    model_normalized: null,
    grader_harness: resolveHarness(undefined, 'GRADER_HARNESS'),
    grader_model: null,
    wall_s: runMeta.wall_ms != null ? Math.round(runMeta.wall_ms / 1000) : null,
    ttft_s: null,
    cost_usd: null,
    cost_source: 'n/a',
    tokens: {
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      total_tokens: null,
    },
    tool_calls: 0,
    tools_used: [],
    llm_calls: 0,
    subagent_count: 0,
    error_count: 0,
    signals: {
      numeric_match: null,
      semantic_match: null,
      columns_match: null,
      filters_match: null,
    },
    accuracy: null,
    details: {
      expected_columns: birdCase.expected_columns,
      actual_columns: [],
      missing_columns: [],
      expected_filter_fields: birdCase.expected_filter_fields,
      actual_filter_fields: [],
      missing_filter_fields: [],
      expected_value: birdCase.answer_type === 'scalar' ? birdCase.expected_value : null,
      expected_row_count: birdCase.expected_row_count,
      extracted_number: null,
      final_message_preview: '',
      llm_judge: null,
      llm_judge_error: null,
      trace_error: null,
    },
    verdict: 'grading_error',
  };

  // ── Fetch trace (single source of truth) ─────────────────────────────────
  const client = makeClient();
  const summary = await fetchTraceSummary(client, {
    projectName,
    evalRunId,
    pollIntervalMs: Number(process.env.GRADE_TRACE_POLL_MS ?? 5_000),
    timeoutMs: Number(process.env.GRADE_TRACE_TIMEOUT_MS ?? 60_000),
  });

  if (!summary) {
    baseResult.details.trace_error = `No LangSmith trace found for eval_run_id=${evalRunId} in project "${projectName}" within the timeout. Ensure the coding-agent LangSmith plugin is installed and configured for the ${runMeta.harness ?? 'agent'} harness.`;
    baseResult.verdict = 'grading_error';
    const p = writeResult(baseResult);
    console.error(`\nGrade: Q${questionId} — GRADING_ERROR (no trace)`);
    console.error(baseResult.details.trace_error);
    console.error(`Result: ${p}`);
    return;
  }

  // ── Metrics from trace ────────────────────────────────────────────────────
  baseResult.model = summary.model ?? runMeta.model ?? null;
  baseResult.model_normalized = normalizeModel(baseResult.model);
  baseResult.ttft_s = summary.ttftMs != null ? Math.round(summary.ttftMs / 100) / 10 : null;
  if (summary.wallMs != null) baseResult.wall_s = Math.round(summary.wallMs / 1000);
  baseResult.cost_usd = summary.costUsd;
  baseResult.cost_source = summary.costSource;
  baseResult.tokens = {
    input_tokens: summary.tokens.input,
    output_tokens: summary.tokens.output,
    cache_read_tokens: summary.tokens.cacheRead,
    cache_creation_tokens: summary.tokens.cacheWrite,
    total_tokens: summary.tokens.total,
  };
  baseResult.tool_calls = summary.toolCalls.length;
  baseResult.tools_used = [...new Set(summary.toolCalls.map((t) => t.normalizedName))];
  baseResult.llm_calls = summary.llmRunCount;
  baseResult.subagent_count = summary.subagentCount;
  baseResult.error_count = summary.errorCount;

  const finalMessage = summary.finalText;
  baseResult.details.final_message_preview = finalMessage.slice(0, 500);

  // ── Signals 1 & 2: columns_match / filters_match ─────────────────────────
  const queryCalls = summary.toolCalls.filter((t) => t.normalizedName === 'query-datasource');
  if (queryCalls.length > 0) {
    const allActualColumns = new Set<string>();
    const allActualFilters = new Set<string>();
    for (const call of queryCalls) {
      const query = findVizqlQuery(call.inputs) as VizqlQuery | null;
      for (const c of collectFieldCaptions(query?.fields)) allActualColumns.add(c);
      for (const f of collectFilterCaptions(query?.filters)) allActualFilters.add(f);
    }
    baseResult.details.actual_columns = [...allActualColumns];
    baseResult.details.actual_filter_fields = [...allActualFilters];
    baseResult.details.missing_columns = birdCase.expected_columns.filter(
      (c) => !allActualColumns.has(c.toLowerCase()),
    );
    baseResult.details.missing_filter_fields = birdCase.expected_filter_fields.filter(
      (f) => !allActualFilters.has(f.toLowerCase()),
    );
    baseResult.signals.columns_match =
      baseResult.details.missing_columns.length === 0 && birdCase.expected_columns.length > 0;
    baseResult.signals.filters_match =
      baseResult.details.missing_filter_fields.length === 0 &&
      birdCase.expected_filter_fields.length > 0;
  }

  // ── Signal 3: numeric_match ───────────────────────────────────────────────
  if (finalMessage) {
    const numeric = checkNumericMatch(finalMessage, birdCase);
    baseResult.signals.numeric_match = numeric.matched;
    baseResult.details.extracted_number = numeric.extracted;
  }

  // ── Signal 4: semantic_match (judge via GRADER_HARNESS) ──────────────────
  if (!finalMessage) {
    baseResult.details.llm_judge_error = 'No final message found in trace outputs.';
  } else {
    const judge = runJudge(birdCase, finalMessage);
    baseResult.grader_harness = judge.harness;
    baseResult.grader_model = judge.model;
    baseResult.details.llm_judge = judge.result;
    baseResult.details.llm_judge_error = judge.error;
    baseResult.signals.semantic_match = judge.result?.score ?? null;
  }

  // ── Verdict + accuracy ────────────────────────────────────────────────────
  const s = baseResult.signals;
  baseResult.verdict = (() => {
    if (runMeta.agent_exit_code != null && runMeta.agent_exit_code !== 0) return 'error';
    if (summary.hadError && s.semantic_match === null && s.numeric_match === null) return 'error';
    if (s.semantic_match === null && s.numeric_match === null) return 'skip';
    const semanticOk = s.semantic_match != null && s.semantic_match >= 0.8;
    const numericOk = s.numeric_match === true;
    if (semanticOk && numericOk) return 'pass';
    if (semanticOk || numericOk) return 'partial';
    return 'fail';
  })();
  baseResult.accuracy =
    baseResult.verdict === 'pass'
      ? 1
      : baseResult.verdict === 'partial'
        ? 0.5
        : baseResult.verdict === 'fail'
          ? 0
          : null;

  const resultPath = writeResult(baseResult);

  // ── Print summary ─────────────────────────────────────────────────────────
  console.log(`\nGrade: Q${questionId} (${difficulty}) — ${baseResult.verdict.toUpperCase()}`);
  console.log(`Harness/model:  ${baseResult.harness ?? '?'} / ${baseResult.model ?? 'n/a'}`);
  console.log(
    `numeric_match:  ${s.numeric_match === null ? 'n/a' : s.numeric_match ? 'YES' : 'NO'}`,
  );
  console.log(
    `semantic_match: ${s.semantic_match === null ? 'n/a' : s.semantic_match.toFixed(2)}` +
      (baseResult.details.llm_judge
        ? ` — ${baseResult.details.llm_judge.reason}`
        : baseResult.details.llm_judge_error
          ? ` (${baseResult.details.llm_judge_error})`
          : ''),
  );
  console.log(
    `columns_match:  ${s.columns_match === null ? 'n/a' : s.columns_match ? 'YES' : `NO (missing: ${baseResult.details.missing_columns.join(', ')})`}`,
  );
  console.log(
    `filters_match:  ${s.filters_match === null ? 'n/a' : s.filters_match ? 'YES' : `NO (missing: ${baseResult.details.missing_filter_fields.join(', ')})`}`,
  );
  console.log(`Wall / TTFT:    ${baseResult.wall_s ?? '?'}s / ${baseResult.ttft_s ?? '?'}s`);
  console.log(
    `Cost:           ${baseResult.cost_usd != null ? `$${baseResult.cost_usd.toFixed(4)} (${baseResult.cost_source})` : 'n/a'}`,
  );
  console.log(
    `Tokens (total): ${baseResult.tokens.total_tokens ?? 'n/a'} | LLM calls: ${baseResult.llm_calls} | errors: ${baseResult.error_count}`,
  );
  console.log(
    `Tool calls:     ${baseResult.tool_calls} (${baseResult.tools_used.join(', ') || 'none'})`,
  );
  console.log(`Result:         ${resultPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
