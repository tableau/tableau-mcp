import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { ExpectedAnswer } from '../cases/dataQuestions.js';

export type ArmId = 'A' | 'B' | 'C';

/**
 * Client-side token usage, summed over the agent's model responses for one turn.
 *
 * These counts cover ONLY the client model driving Tableau MCP. When the client calls `tableau-agent-ask`,
 * Tableau Agent runs its own LLM calls inside CES / the LLM gateway, and those tokens are NOT
 * included here. Arm B (and any arm C run that uses CABU) therefore under-reports total token
 * cost; compare it to arm A only together with server-side token counts.
 */
export type TokenUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type GradeMethod = 'numeric' | 'judge' | 'none';

export type TurnRecord = {
  turn: number;
  prompt: string;
  latencyMs: number;
  usage: TokenUsage;
  toolCalls: Array<string>;
  usedCabu: boolean;
  finalOutput: string;
  correct: boolean;
  gradeMethod: GradeMethod;
  gradeDetail: string;
  error?: string;
  timedOut?: boolean;
};

export type RunRecord = {
  arm: ArmId;
  caseId: string;
  repeat: number;
  model: string;
  latencyMs: number;
  usage: TokenUsage;
  usedCabu: boolean;
  correct: boolean;
  errored: boolean;
  timedOut: boolean;
  /** The model queried another data source or workbook than the case's; see `checkSourceChoice`. */
  sourceProblems: Array<string>;
  turns: Array<TurnRecord>;
};

export const emptyUsage = (): TokenUsage => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    requests: a.requests + b.requests,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

const SUFFIX_MULTIPLIER: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** Pulls every number out of an answer, expanding "739.8K" / "$0.74M" style suffixes. */
export function extractNumbers(text: string): Array<number> {
  const decoded = text.replace(/&amp;/g, '&').replace(/&#36;/g, '$');
  const numbers: Array<number> = [];
  // The sign may come before a currency symbol: "-$19.17M".
  for (const match of decoded.matchAll(/(-?)\$?(\d[\d,]*(?:\.\d+)?)\s*([kKmMbB])?\b/g)) {
    const value = Number(`${match[1]}${match[2].replace(/,/g, '')}`);
    if (Number.isNaN(value)) {
      continue;
    }
    const suffix = match[3]?.toLowerCase();
    numbers.push(suffix ? value * SUFFIX_MULTIPLIER[suffix] : value);
  }
  return numbers;
}

/** True when every expected number appears in the answer within the relative tolerance. */
export function checkNumbers(
  answer: string,
  expected: ExpectedAnswer,
): { pass: boolean; missing: Array<number> } {
  const tolerance = expected.tolerance ?? 0.005;
  const found = extractNumbers(answer);
  const missing = (expected.numbers ?? []).filter(
    (want) =>
      !found.some((got) => Math.abs(got - want) <= Math.abs(want) * tolerance + Number.EPSILON),
  );
  return { pass: missing.length === 0, missing };
}

function percentile(values: Array<number>, p: number): number {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((x, y) => x - y);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const mean = (values: Array<number>): number =>
  values.length === 0 ? NaN : values.reduce((sum, v) => sum + v, 0) / values.length;

export type ArmSummary = {
  arm: ArmId;
  runs: number;
  caseAccuracy: number;
  turnAccuracy: number;
  latencyMs: { p50: number; p95: number; mean: number };
  meanUsage: TokenUsage;
  cabuUsageRate: number;
  errors: number;
  wrongSource: number;
  timeouts: number;
};

export function summarize(arm: ArmId, runs: Array<RunRecord>): ArmSummary {
  const turns = runs.flatMap((run) => run.turns);
  const latencies = runs.map((run) => run.latencyMs);
  return {
    arm,
    runs: runs.length,
    caseAccuracy: mean(runs.map((run) => (run.correct ? 1 : 0))),
    turnAccuracy: mean(turns.map((turn) => (turn.correct ? 1 : 0))),
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      mean: mean(latencies),
    },
    meanUsage: {
      requests: mean(runs.map((run) => run.usage.requests)),
      inputTokens: mean(runs.map((run) => run.usage.inputTokens)),
      outputTokens: mean(runs.map((run) => run.usage.outputTokens)),
      totalTokens: mean(runs.map((run) => run.usage.totalTokens)),
    },
    cabuUsageRate: mean(runs.map((run) => (run.usedCabu ? 1 : 0))),
    errors: runs.filter((run) => run.errored).length,
    wrongSource: runs.filter((run) => run.sourceProblems.length > 0).length,
    timeouts: runs.filter((run) => run.timedOut).length,
  };
}

const pct = (value: number): string =>
  Number.isNaN(value) ? 'n/a' : `${(value * 100).toFixed(0)}%`;
const secs = (ms: number): string => (Number.isNaN(ms) ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);
const num = (value: number): string => (Number.isNaN(value) ? 'n/a' : Math.round(value).toString());

export function toMarkdown(
  summaries: Array<ArmSummary>,
  runs: Array<RunRecord>,
  model: string,
): string {
  const lines = [
    '# Tableau Agent (CABU) A/B eval',
    '',
    `Client model: \`${model}\`. Generated ${new Date().toISOString()}.`,
    '',
    '> Token counts are client-side only. They exclude the LLM tokens Tableau Agent spends server-side',
    '> (CES / LLM gateway) when `tableau-agent-ask` runs, so arms that use CABU under-report total cost.',
    '',
    '| Arm | Runs | Case accuracy | Turn accuracy | Latency p50 | Latency p95 | Latency mean | Mean input tok | Mean output tok | Mean total tok | Mean requests | CABU usage | Wrong source | Errors | Timeouts |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...summaries.map(
      (s) =>
        `| ${s.arm} | ${s.runs} | ${pct(s.caseAccuracy)} | ${pct(s.turnAccuracy)} | ${secs(s.latencyMs.p50)} | ${secs(s.latencyMs.p95)} | ${secs(s.latencyMs.mean)} | ${num(s.meanUsage.inputTokens)} | ${num(s.meanUsage.outputTokens)} | ${num(s.meanUsage.totalTokens)} | ${s.meanUsage.requests.toFixed(1)} | ${pct(s.cabuUsageRate)} | ${s.wrongSource} | ${s.errors} | ${s.timeouts} |`,
    ),
    '',
    '## Runs',
    '',
    '| Arm | Case | Repeat | Correct | Latency | Total tok | Used CABU | Tools | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    ...runs.map((run) => {
      const tools = run.turns.map((turn) => turn.toolCalls.join(', ') || '-').join(' / ');
      const notes = [
        ...run.sourceProblems,
        ...run.turns.map((turn) => turn.error ?? (turn.correct ? '' : turn.gradeDetail)),
      ]
        .filter(Boolean)
        .join(' / ')
        .replace(/\|/g, '\\|')
        .replace(/\n/g, ' ')
        .slice(0, 200);
      return `| ${run.arm} | ${run.caseId} | ${run.repeat} | ${run.correct ? 'yes' : 'no'} | ${secs(run.latencyMs)} | ${run.usage.totalTokens} | ${run.usedCabu ? 'yes' : 'no'} | ${tools} | ${notes} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

export const RESULTS_DIR = join('tests', 'eval', 'results');

export function writeResults(
  runs: Array<RunRecord>,
  model: string,
): { json: string; markdown: string } {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const arms = [...new Set(runs.map((run) => run.arm))].sort();
  const summaries = arms.map((arm) =>
    summarize(
      arm,
      runs.filter((run) => run.arm === arm),
    ),
  );

  const json = join(RESULTS_DIR, `cabu-ab-${stamp}.json`);
  const markdown = join(RESULTS_DIR, `cabu-ab-${stamp}.md`);
  writeFileSync(json, JSON.stringify({ model, summaries, runs }, null, 2));
  writeFileSync(markdown, toMarkdown(summaries, runs, model));
  return { json, markdown };
}
