/**
 * BIRD-specific grader for California Schools eval runs.
 *
 * Grades a single run directory using four signals:
 *   columns_match   — required VizQL fields present in the query-datasource call
 *   filters_match   — required filter fields present in the query-datasource call
 *   numeric_match   — expected value / row count found in Claude's final message
 *   semantic_match  — LLM judge comparing Claude's final message to the gold summary
 *
 * Usage:
 *   npx tsx evals/grade-bird.ts evals/runs/<run-id>
 *
 * Required environment:
 *   OPENAI_API_KEY  (for LLM judge; set BIRD_GRADE_MODEL to override model)
 */

/* eslint-disable no-console */

import dotenv from 'dotenv';
import * as fs from 'fs';
import OpenAI from 'openai';
import * as path from 'path';

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
  wall_ms?: number;
  claude_exit_code?: number;
  timed_out?: boolean;
  metadata?: {
    question_id?: number;
    difficulty?: string;
    suite_file?: string;
  };
};

type HookRecord = {
  tool_name?: string;
  normalized_tool_name?: string;
  tool_input?: unknown;
};

type VizqlField = {
  fieldCaption?: string;
  fieldAlias?: string;
  function?: string;
  calculation?: string;
  sortDirection?: string;
  sortPriority?: number;
};

type VizqlFilter = {
  field?: {
    fieldCaption?: string;
    calculation?: string;
  };
  filterType?: string;
};

type VizqlQuery = {
  fields?: Array<VizqlField>;
  filters?: Array<VizqlFilter>;
};

type QueryDatasourceInput = {
  datasource_luid?: string;
  query?: VizqlQuery;
  options?: unknown;
};

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

type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type TokenTotals = {
  input_tokens: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  output_tokens: number | null;
  total_context_tokens: number | null;
};

type ClaudeStreamEvent = {
  type?: string;
  result?: string;
  usage?: TokenUsage;
  modelUsage?: TokenUsage;
  message?: {
    model?: string;
    usage?: TokenUsage;
    content?: Array<{ type?: string; text?: string }> | string;
  };
};

type LlmJudgeResult = {
  correct: boolean;
  score: number;
  reason: string;
};

type BirdGradeResult = {
  run_id: string;
  question_id: number;
  difficulty: string;
  graded_at: string;
  model: string | null;
  wall_s: number | null;
  tokens: TokenTotals;
  tool_calls: number;
  tools_used: Array<string>;
  signals: {
    numeric_match: boolean | null;
    semantic_match: number | null;
    columns_match: boolean | null;
    filters_match: boolean | null;
  };
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
  };
  verdict: 'pass' | 'partial' | 'fail' | 'error' | 'skip';
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    .filter((v): v is T => v !== null);
}

function readOptionalJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function normalizeToolName(toolName: string): string {
  const parts = toolName.split('__');
  const raw = parts[parts.length - 1] || toolName;
  return raw.replace(/^tableau_/, '').replace(/^tableau-/, '');
}

function parseStreamEvents(agentOutputJsonl: string): Array<ClaudeStreamEvent> {
  return agentOutputJsonl
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as ClaudeStreamEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is ClaudeStreamEvent => e !== null);
}

function sumUsage(events: Array<ClaudeStreamEvent>): TokenTotals {
  let input = 0;
  let cacheCreate = 0;
  let cacheRead = 0;
  let output = 0;
  let found = false;

  for (const event of events) {
    const u = event.message?.usage ?? event.usage ?? event.modelUsage;
    if (!u) continue;
    input += u.input_tokens ?? 0;
    cacheCreate += u.cache_creation_input_tokens ?? 0;
    cacheRead += u.cache_read_input_tokens ?? 0;
    output += u.output_tokens ?? 0;
    found = true;
  }

  if (!found) {
    return {
      input_tokens: null,
      cache_creation_tokens: null,
      cache_read_tokens: null,
      output_tokens: null,
      total_context_tokens: null,
    };
  }

  return {
    input_tokens: input,
    cache_creation_tokens: cacheCreate,
    cache_read_tokens: cacheRead,
    output_tokens: output,
    total_context_tokens: input + cacheCreate + cacheRead,
  };
}

/**
 * Extract token totals from the stream.
 * Prefers the result event's aggregated usage when available (session-level total
 * from Claude Code). Falls back to summing across all assistant events.
 */
function extractTokenTotals(events: Array<ClaudeStreamEvent>): TokenTotals {
  // If the result event carries an aggregate, use it — but it may lack cache breakdown.
  // Sum across all assistant events instead, which have per-turn cache detail.
  const assistantEvents = events.filter((e) => e.type === 'assistant');
  if (assistantEvents.length > 0) return sumUsage(assistantEvents);

  // Last resort: result event usage.
  const resultEvents = events.filter((e) => e.type === 'result');
  if (resultEvents.length > 0) return sumUsage(resultEvents);

  return sumUsage([]);
}

/** Extract the model name from the first assistant message in the stream. */
function extractModelName(events: Array<ClaudeStreamEvent>): string | null {
  for (const event of events) {
    if (event.type === 'assistant' && event.message?.model) {
      return event.message.model;
    }
  }
  return null;
}

/** Extract the final assistant text from Claude's stream-json output. */
function extractFinalMessage(agentOutputJsonl: string): string {
  const events = parseStreamEvents(agentOutputJsonl);

  // Prefer the result event's text field
  const resultEvents = events.filter((e) => e.type === 'result' && e.result);
  if (resultEvents.length > 0) {
    return resultEvents[resultEvents.length - 1].result ?? '';
  }

  // Fall back to the last assistant message's text content
  const assistantEvents = events.filter((e) => e.type === 'assistant');
  for (let i = assistantEvents.length - 1; i >= 0; i--) {
    const content = assistantEvents[i].message?.content;
    if (Array.isArray(content)) {
      const textBlocks = content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text ?? '');
      if (textBlocks.length > 0) return textBlocks.join('\n');
    }
    if (typeof content === 'string' && content.trim()) return content;
  }

  return '';
}

/** Extract all query-datasource tool inputs from hook.jsonl. */
function extractQueryDatasourceInputs(hookRecords: Array<HookRecord>): Array<QueryDatasourceInput> {
  return hookRecords
    .filter(
      (r) => normalizeToolName(r.normalized_tool_name ?? r.tool_name ?? '') === 'query-datasource',
    )
    .map((r) => r.tool_input as QueryDatasourceInput)
    .filter(Boolean);
}

/** Collect field captions from a VizQL fields array. */
function collectFieldCaptions(fields: Array<VizqlField> | undefined): Array<string> {
  return (fields ?? [])
    .map((f) => f.fieldCaption ?? '')
    .filter(Boolean)
    .map((c) => c.toLowerCase());
}

/** Collect filter field captions from a VizQL filters array. */
function collectFilterCaptions(filters: Array<VizqlFilter> | undefined): Array<string> {
  return (filters ?? [])
    .map((f) => f.field?.fieldCaption ?? '')
    .filter(Boolean)
    .map((c) => c.toLowerCase());
}

/**
 * Try to extract a number from the final message that matches the expected value.
 * Returns the extracted number, or null if no suitable number was found.
 */
function extractMatchingNumber(text: string, expected: number | string | null): number | null {
  if (expected === null) return null;

  // Normalize expected to a number if possible
  let expectedNum: number | null = null;
  if (typeof expected === 'number') {
    expectedNum = expected;
  } else {
    const parsed = parseFloat(String(expected).replace(/,/g, ''));
    if (!isNaN(parsed)) expectedNum = parsed;
  }
  if (expectedNum === null) return null;

  // Extract all numbers from the message (strip commas first)
  const clean = text.replace(/,/g, '');
  const matches = clean.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const candidates = matches.map((m) => parseFloat(m)).filter((n) => !isNaN(n));

  // Look for a match with tolerance
  const isClose = (a: number, b: number): boolean => {
    if (b === 0) return Math.abs(a) < 0.001;
    return Math.abs(a - b) / Math.abs(b) <= 0.01 || Math.abs(a - b) <= 0.001;
  };

  // Also check percentage form (e.g. "90.5%" for 0.905)
  const percentageCandidates = candidates.map((n) => n / 100);

  for (const candidate of [...candidates, ...percentageCandidates]) {
    if (isClose(candidate, expectedNum)) return candidate;
  }
  return null;
}

/**
 * Check if a numeric answer (or row count) appears in the final message.
 */
function checkNumericMatch(
  finalMessage: string,
  birdCase: BirdCase,
): { matched: boolean; extracted: number | null } {
  const target =
    birdCase.answer_type === 'scalar' ? birdCase.expected_value : birdCase.expected_row_count;

  if (target === null) return { matched: false, extracted: null };

  // For string scalars (school names, phone numbers), do a case-insensitive substring check
  if (typeof target === 'string') {
    const matched = finalMessage.toLowerCase().includes(target.toLowerCase());
    return { matched, extracted: null };
  }

  const extracted = extractMatchingNumber(finalMessage, target);
  return { matched: extracted !== null, extracted };
}

// ─── LLM Judge ───────────────────────────────────────────────────────────────

async function runLlmJudge(
  birdCase: BirdCase,
  finalMessage: string,
  openai: OpenAI,
  model: string,
): Promise<LlmJudgeResult> {
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
    'Respond with JSON only:',
    '{"correct": true|false, "score": 0.0-1.0, "reason": "one sentence"}',
  ].join('\n');

  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(raw) as Partial<LlmJudgeResult>;
  return {
    correct: parsed.correct ?? false,
    score: typeof parsed.score === 'number' ? parsed.score : parsed.correct ? 1.0 : 0.0,
    reason: parsed.reason ?? '',
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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

  const hookRecords = readJsonl<HookRecord>(path.join(absRunDir, 'hook.jsonl'));
  const agentOutputRaw = fs.existsSync(path.join(absRunDir, 'agent-output.jsonl'))
    ? fs.readFileSync(path.join(absRunDir, 'agent-output.jsonl'), 'utf-8')
    : '';

  const streamEvents = parseStreamEvents(agentOutputRaw);
  const modelName = extractModelName(streamEvents);
  const tokens = extractTokenTotals(streamEvents);
  const finalMessage = extractFinalMessage(agentOutputRaw);
  const queryInputs = extractQueryDatasourceInputs(hookRecords);

  // ── Signal 1 & 2: columns_match, filters_match ──────────────────────────

  let columnsMatch: boolean | null = null;
  let filtersMatch: boolean | null = null;
  let actualColumns: Array<string> = [];
  let actualFilterFields: Array<string> = [];
  let missingColumns: Array<string> = [];
  let missingFilterFields: Array<string> = [];

  if (queryInputs.length > 0) {
    // Union of all columns/filters across all query-datasource calls (agent may call it multiple times)
    const allActualColumns = new Set<string>();
    const allActualFilters = new Set<string>();
    for (const input of queryInputs) {
      for (const c of collectFieldCaptions(input.query?.fields)) allActualColumns.add(c);
      for (const f of collectFilterCaptions(input.query?.filters)) allActualFilters.add(f);
    }
    actualColumns = [...allActualColumns];
    actualFilterFields = [...allActualFilters];

    const expectedColsLower = birdCase.expected_columns.map((c) => c.toLowerCase());
    const expectedFiltersLower = birdCase.expected_filter_fields.map((f) => f.toLowerCase());

    missingColumns = birdCase.expected_columns.filter(
      (c) => !allActualColumns.has(c.toLowerCase()),
    );
    missingFilterFields = birdCase.expected_filter_fields.filter(
      (f) => !allActualFilters.has(f.toLowerCase()),
    );

    columnsMatch = missingColumns.length === 0 && expectedColsLower.length > 0;
    filtersMatch = missingFilterFields.length === 0 && expectedFiltersLower.length > 0;
  }

  // ── Signal 3: numeric_match ─────────────────────────────────────────────

  let numericMatch: boolean | null = null;
  let extractedNumber: number | null = null;
  if (finalMessage) {
    const result = checkNumericMatch(finalMessage, birdCase);
    numericMatch = result.matched;
    extractedNumber = result.extracted;
  }

  // ── Signal 4: semantic_match (LLM judge) ────────────────────────────────

  let semanticMatch: number | null = null;
  let llmJudge: LlmJudgeResult | null = null;
  let llmJudgeError: string | null = null;

  if (!finalMessage) {
    llmJudgeError = 'No final message found in agent output.';
  } else {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      llmJudgeError = 'OPENAI_API_KEY not set; skipping LLM judge.';
      console.warn('WARN: OPENAI_API_KEY not set — semantic_match will be null.');
    } else {
      const openai = new OpenAI({ apiKey: openaiKey });
      const judgeModel = process.env.BIRD_GRADE_MODEL ?? 'gpt-4o-mini';
      try {
        llmJudge = await runLlmJudge(birdCase, finalMessage, openai, judgeModel);
        semanticMatch = llmJudge.score;
      } catch (error: unknown) {
        llmJudgeError = error instanceof Error ? error.message : String(error);
        console.error(`LLM judge error: ${llmJudgeError}`);
      }
    }
  }

  // ── Verdict ──────────────────────────────────────────────────────────────

  function deriveVerdict(): BirdGradeResult['verdict'] {
    if (runMeta?.claude_exit_code != null && runMeta.claude_exit_code !== 0) return 'error';
    // columns_match / filters_match are diagnostic only — they do not drive the verdict.
    // Verdict is determined solely by whether the agent produced the correct answer.
    if (semanticMatch === null && numericMatch === null) return 'skip';
    const semanticOk = semanticMatch != null && semanticMatch >= 0.8;
    const numericOk = numericMatch === true;
    if (semanticOk && numericOk) return 'pass';
    if (semanticOk || numericOk) return 'partial';
    return 'fail';
  }

  // ── Tool summary ─────────────────────────────────────────────────────────

  const toolsUsed = [
    ...new Set(
      hookRecords
        .map((r) => normalizeToolName(r.normalized_tool_name ?? r.tool_name ?? ''))
        .filter(Boolean),
    ),
  ];

  // ── Assemble result ──────────────────────────────────────────────────────

  const birdResult: BirdGradeResult = {
    run_id: runMeta.run_id,
    question_id: questionId,
    difficulty: runMeta.metadata?.difficulty ?? birdCase.difficulty ?? 'unknown',
    graded_at: new Date().toISOString(),
    model: modelName,
    wall_s: runMeta.wall_ms != null ? Math.round(runMeta.wall_ms / 1000) : null,
    tokens,
    tool_calls: hookRecords.length,
    tools_used: toolsUsed,
    signals: {
      numeric_match: numericMatch,
      semantic_match: semanticMatch,
      columns_match: columnsMatch,
      filters_match: filtersMatch,
    },
    details: {
      expected_columns: birdCase.expected_columns,
      actual_columns: actualColumns,
      missing_columns: missingColumns,
      expected_filter_fields: birdCase.expected_filter_fields,
      actual_filter_fields: actualFilterFields,
      missing_filter_fields: missingFilterFields,
      expected_value: birdCase.answer_type === 'scalar' ? birdCase.expected_value : null,
      expected_row_count: birdCase.expected_row_count,
      extracted_number: extractedNumber,
      final_message_preview: finalMessage.slice(0, 500),
      llm_judge: llmJudge,
      llm_judge_error: llmJudgeError,
    },
    verdict: deriveVerdict(),
  };

  const runId = path.basename(absRunDir);
  const gradeDir = path.join(GRADES_DIR, dateSlug(), runId);
  fs.mkdirSync(gradeDir, { recursive: true });
  const resultPath = path.join(gradeDir, 'bird-result.json');
  fs.writeFileSync(resultPath, JSON.stringify(birdResult, null, 2));

  // ── Print summary ─────────────────────────────────────────────────────────

  const v = birdResult.verdict.toUpperCase();
  const s = birdResult.signals;
  console.log(`\nGrade: Q${questionId} (${birdResult.difficulty})`);
  console.log(`Verdict:        ${v}`);
  console.log(
    `numeric_match:  ${s.numeric_match === null ? 'n/a' : s.numeric_match ? 'YES' : 'NO'}`,
  );
  console.log(
    `semantic_match: ${s.semantic_match === null ? 'n/a' : s.semantic_match.toFixed(2)}` +
      (llmJudge ? ` — ${llmJudge.reason}` : llmJudgeError ? ` (${llmJudgeError})` : ''),
  );
  console.log(
    `columns_match:  ${s.columns_match === null ? 'n/a' : s.columns_match ? 'YES' : `NO (missing: ${missingColumns.join(', ')})`}`,
  );
  console.log(
    `filters_match:  ${s.filters_match === null ? 'n/a' : s.filters_match ? 'YES' : `NO (missing: ${missingFilterFields.join(', ')})`}`,
  );
  const t = birdResult.tokens;
  console.log(`Model:          ${birdResult.model ?? 'n/a'}`);
  console.log(`Wall time:      ${birdResult.wall_s != null ? `${birdResult.wall_s}s` : 'n/a'}`);
  console.log(`Tokens (total context): ${t.total_context_tokens ?? 'n/a'}`);
  console.log(`  input:          ${t.input_tokens ?? 'n/a'}`);
  console.log(`  cache_creation: ${t.cache_creation_tokens ?? 'n/a'}`);
  console.log(`  cache_read:     ${t.cache_read_tokens ?? 'n/a'}`);
  console.log(`  output:         ${t.output_tokens ?? 'n/a'}`);
  console.log(`Tool calls:     ${birdResult.tool_calls} (${toolsUsed.join(', ') || 'none'})`);
  console.log(`Result:         ${resultPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
