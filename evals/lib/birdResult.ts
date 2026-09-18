/**
 * Canonical on-disk shape of a graded BIRD case (`bird-result.json`).
 *
 * This is the single source of truth for the result type: `grade-bird.ts` writes
 * it, and `grade-suite.ts` / `report.ts` read it back. Previously each of those
 * files hand-declared its own (mutually-inconsistent) copy of this shape; they now
 * all import `BirdGradeResult` from here. Consumers that only touch a subset of the
 * fields still typecheck against the richer canonical type.
 */

import { TraceSummary } from '../langsmith-reader.js';

export type LlmJudgeResult = { correct: boolean; score: number; reason: string };

export type BirdGradeResult = {
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
