/**
 * Validation rule: invalid-derivation-string
 *
 * A column-instance's `derivation` attribute must be one of the canonical Tableau
 * derivation strings. Look-alike strings such as `Attr` (not `Attribute`) or
 * `TruncMonth` / `TruncYear` / `TruncDay` (not `Month-Trunc` / `Year-Trunc` /
 * `Day-Trunc`) are NOT rejected on load — Tableau silently rewrites both the
 * derivation and the CI name to `None`, so the intended truncation/aggregation is
 * dropped and the chart renders blank or unaggregated with no error. This preflight
 * turns that silent rewrite into an actionable "fix this string" before the XML is
 * ever sent to Tableau.
 *
 * Severity: ERROR. An invalid derivation string is never intentional — it always
 * degrades the render silently.
 *
 * Ported from agent-to-tableau-desktop
 * (src/validation/rules/invalid-derivation-string.ts) into tableau-mcp's rule shape:
 * xmldom + xpath (matching calcFieldNames), plain `validate(xml)` signature, no
 * a2td-specific trigger/context/doc plumbing.
 */
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

/**
 * Canonical `derivation` attribute values, case-sensitive and exact. Any
 * `column-instance` derivation outside this closed set silently rewrites to None on
 * load. Exported so other code can share the single allowlist.
 */
export const CANONICAL_DERIVATIONS = new Set<string>([
  // Dimension
  'None',
  'Attribute',
  // Date part (discrete/continuous)
  'Year',
  'Quarter',
  'Month',
  'Week',
  'Weekday',
  'Day',
  'Hour',
  'Minute',
  'Second',
  'MY',
  'MDY',
  'ISO-Year',
  'ISO-Qtr',
  'ISO-Week',
  'ISO-Weekday',
  // Date truncation
  'Year-Trunc',
  'ISO-Year-Trunc',
  'Quarter-Trunc',
  'ISO-Qtr-Trunc',
  'ISO-Week-Trunc',
  'Month-Trunc',
  'Week-Trunc',
  'Day-Trunc',
  'Hour-Trunc',
  'Minute-Trunc',
  'Second-Trunc',
  // Measure aggregation
  'Sum',
  'Avg',
  'Count',
  'CountD',
  'Median',
  'Min',
  'Max',
  'Stdev',
  'StdevP',
  'Var',
  'VarP',
  // Table calc
  'User',
]);

/** Best-effort canonical suggestion for the most common invalid look-alikes. */
const KNOWN_CORRECTIONS: Record<string, string> = {
  Attr: 'Attribute',
  TruncYear: 'Year-Trunc',
  TruncatedToYear: 'Year-Trunc',
  TruncMonth: 'Month-Trunc',
  TruncatedToMonth: 'Month-Trunc',
  TruncDay: 'Day-Trunc',
  TruncatedToDay: 'Day-Trunc',
  TruncQuarter: 'Quarter-Trunc',
  TruncWeek: 'Week-Trunc',
};

export const invalidDerivationStringRule: ValidationRule = {
  id: 'invalid-derivation-string',
  description:
    'Errors when a column-instance derivation is outside the canonical Tableau set ' +
    '(e.g. Attr, TruncMonth); such strings silently rewrite to None on load, dropping the ' +
    'intended aggregation/truncation and rendering blank/unaggregated.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    // Suppress parser error output; malformed XML is reported by well-formed-xml.
    let doc: Document;
    try {
      const parser = new DOMParser({
        errorHandler: () => {},
      });
      doc = parser.parseFromString(xml.trim() || '<empty/>', 'text/xml') as unknown as Document;
    } catch {
      return [];
    }

    const cis = xpath.select('//column-instance[@derivation]', doc as unknown as Node) as Element[];

    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const ci of cis) {
      const derivation = ci.getAttribute('derivation') ?? '';
      if (!derivation) continue;
      if (CANONICAL_DERIVATIONS.has(derivation)) continue;
      if (seen.has(derivation)) continue;
      seen.add(derivation);

      const name = ci.getAttribute('name') ?? '';
      const correction = KNOWN_CORRECTIONS[derivation];
      const fixHint = correction
        ? `Use the canonical string "${correction}" instead of "${derivation}".`
        : 'Use a canonical derivation string (e.g. Year-Trunc, Month-Trunc, Sum, CountD, Attribute, User).';

      issues.push({
        ruleId: 'invalid-derivation-string',
        severity: 'error',
        message:
          `Invalid column-instance derivation "${derivation}"` +
          (name ? ` on ${name}` : '') +
          ': it is not a recognized Tableau derivation, so Tableau silently rewrites both the ' +
          'derivation and the CI name to None on load — the field renders with no aggregation/' +
          `truncation applied (blank or unaggregated), with no error. ${fixHint}`,
        xpath: `//column-instance[@derivation="${derivation}"]`,
        suggestion: fixHint,
      });
    }

    return issues;
  },
};
