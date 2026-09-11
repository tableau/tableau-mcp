/**
 * Small numeric aggregation helpers shared across the eval reporting/grading
 * scripts. Extracted verbatim from report.ts (the most complete/consistent copy)
 * so grade-suite.ts can reuse the same rounding semantics instead of re-deriving
 * them inline.
 */

/** Arithmetic mean, or null for an empty list. */
export function mean(values: Array<number>): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Sum of a list (0 for empty). */
export function sum(values: Array<number>): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Round to `places` decimals, passing null through unchanged. */
export function round(value: number | null, places: number): number | null {
  if (value == null) return null;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Fraction of non-null booleans that are true, or null when none are defined. */
export function rate(values: Array<boolean | null>): number | null {
  const defined = values.filter((v): v is boolean => v != null);
  return defined.length ? defined.filter(Boolean).length / defined.length : null;
}
