/**
 * Per-model pricing map (USD per 1M tokens), used only as a fallback when LangSmith
 * does not report a computed cost for a trace. Keyed by canonical (normalized) model
 * id from `model-normalize.ts`. Keep this current; prices drift.
 *
 * Rates are approximate list prices and intended for relative comparison in reports,
 * not billing. Cache-read is typically a fraction of input; cache-write a small
 * premium. Where a model's exact rates are unknown, omit it — cost will be null.
 */

import { normalizeModel } from './model-normalize.js';

export type ModelPricePer1M = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

// USD per 1,000,000 tokens.
const PRICES: Record<string, ModelPricePer1M> = {
  'claude-opus-4.8': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4.7': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4.6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4.6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4.5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4.5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-3.7-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'gpt-5.6-codex': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-5-codex': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-5.6': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
};

export type TokenCounts = {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};

/**
 * Estimate cost in USD from token counts. Returns null if the model has no pricing
 * entry (so callers can distinguish "free" from "unknown").
 */
export function estimateCostUsd(
  model: string | null | undefined,
  tokens: TokenCounts,
): number | null {
  const canonical = normalizeModel(model);
  const price = PRICES[canonical];
  if (!price) return null;
  const input = tokens.input ?? 0;
  const output = tokens.output ?? 0;
  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;
  const cost =
    (input * price.input +
      output * price.output +
      cacheRead * price.cacheRead +
      cacheWrite * price.cacheWrite) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}
