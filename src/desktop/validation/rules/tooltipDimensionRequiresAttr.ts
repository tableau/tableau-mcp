/**
 * Validation rule: tooltip-dimension-requires-attr
 *
 * A dimension referenced with none:/derivation="None" on a TOOLTIP encoding in an
 * aggregated worksheet must be an Attribute column-instance (attr:) or a usr: calc.
 * Tooltip is the one marks-card property that does NOT participate in the view's
 * level of detail, so Tableau must convert a raw dimension there via ATTR() — and a
 * directly-authored none: instance fails that conversion at render time: the XML
 * applies "successfully", then the sheet blanks with "cannot be converted to a
 * measure using ATTR()".
 *
 * Confirmed P0 (GUS W-23447711, Lee Graber dogfood 2026-07-14): none: dimension on
 * <tooltip> in an aggregated view → ATTR conversion pill errors + blank sheet, with
 * the agent retrying the same broken shape because nothing rejected it. This rule is
 * the preflight backstop that makes the failure visible BEFORE Desktop renders.
 *
 * Severity: error — same class as the other applies-clean-renders-blank rules
 * (aggregate-calc-derivation, undeclared-calc-reference).
 *
 * Scope: <tooltip> ONLY. Text/label encodings are deliberately excluded — dimensions
 * there DO join the view grain (like detail), so none: is legitimate on them.
 * none:...:qk refs are skipped so bin/exact-date quantitative instances never match.
 */
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const FIELD_REF = /\[[^\]]+\]\.\[[^\]]+\]/g;

/** Column-instance prefixes that mark a ref as aggregate (the view is aggregated). */
const AGGREGATE_PREFIXES = new Set([
  'sum',
  'avg',
  'cnt',
  'ctd',
  'med',
  'min',
  'max',
  'std',
  'stp',
  'var',
  'vrp',
  'attr',
  'usr',
]);

interface ParsedRef {
  datasource: string;
  instance: string;
  derivation: string;
  field: string;
  pivot: string;
}

/** Parse `[ds].[deriv:Field:pk]` into its parts; null for anything else (bare refs, calcs). */
function parseFieldRef(ref: string): ParsedRef | null {
  const outer = String(ref ?? '')
    .trim()
    .match(/^\[([^\]]+)\]\.(\[[^\]]+\])$/);
  if (!outer) return null;
  const instance = outer[2];
  const ci = instance.match(/^\[([^:\]]+):([^:\]]+):([^:\]]+)\]$/);
  if (!ci) return null;
  return { datasource: outer[1], instance, derivation: ci[1], field: ci[2], pivot: ci[3] };
}

function isAggregateRef(ref: string): boolean {
  const parsed = parseFieldRef(ref);
  return parsed !== null && AGGREGATE_PREFIXES.has(parsed.derivation.toLowerCase());
}

/** True when the ref is a none: dimension instance (nk/ok pivot — qk = bins/exact dates, skipped). */
function isNoneDimensionRef(ref: string): boolean {
  const parsed = parseFieldRef(ref);
  if (!parsed) return false;
  if (parsed.derivation.toLowerCase() !== 'none') return false;
  const pivot = parsed.pivot.toLowerCase();
  return pivot === 'nk' || pivot === 'ok';
}

/** The view is aggregated when any rows/cols/encoding ref carries an aggregate prefix. */
function worksheetHasAggregateRef(wsNode: Element): boolean {
  for (const node of xpath.select(
    './/rows/text() | .//cols/text()',
    wsNode as unknown as Node,
  ) as Node[]) {
    for (const ref of String(node.nodeValue ?? '').match(FIELD_REF) ?? []) {
      if (isAggregateRef(ref)) return true;
    }
  }
  for (const attr of xpath.select('.//encodings/*/@column', wsNode as unknown as Node) as Attr[]) {
    if (isAggregateRef(attr.value)) return true;
  }
  return false;
}

/** Suggest the attr: form of the same instance, preserving the original pivot suffix. */
function suggestedAttrRef(ref: string): string {
  const parsed = parseFieldRef(ref);
  if (!parsed) return 'an attr: column-instance';
  return `[${parsed.datasource}].[attr:${parsed.field}:${parsed.pivot}]`;
}

export const tooltipDimensionRequiresAttrRule: ValidationRule = {
  id: 'tooltip-dimension-requires-attr',
  description:
    'Errors when a tooltip encoding references a none:/derivation="None" dimension in an aggregated worksheet — ' +
    "Tableau applies the XML, then blanks the sheet with 'cannot be converted to a measure using ATTR()'.",
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc || !doc.documentElement) return [];

    const issues: ValidationIssue[] = [];
    const worksheets = xpath.select('//worksheet', doc as unknown as Node) as Element[];
    const scope = worksheets.length > 0 ? worksheets : [doc.documentElement];

    for (const wsNode of scope) {
      if (!worksheetHasAggregateRef(wsNode)) continue; // disaggregated view: none: on tooltip is legal

      const seen = new Set<string>();
      for (const attr of xpath.select(
        './/encodings/tooltip/@column',
        wsNode as unknown as Node,
      ) as Attr[]) {
        const ref = String(attr.value ?? '').trim();
        if (!ref || seen.has(ref) || !isNoneDimensionRef(ref)) continue;
        seen.add(ref);

        const fixRef = suggestedAttrRef(ref);
        issues.push({
          ruleId: 'tooltip-dimension-requires-attr',
          severity: 'error',
          message:
            `Tooltip encoding references dimension ${ref} with none:/derivation="None" in an aggregated worksheet. ` +
            'Tableau accepts this XML, then blanks the sheet at render with "cannot be converted to a measure using ' +
            `ATTR()". FIX: reference the tooltip dimension as an Attribute column-instance — ${fixRef} with a ` +
            'matching <column-instance derivation="Attribute"> declaration — or use a usr: calc that is valid at ' +
            'the aggregate level.',
          xpath: '//encodings/tooltip/@column',
          suggestion:
            `Declare <column-instance column="[${parseFieldRef(ref)?.field}]" derivation="Attribute" ` +
            `name="[attr:${parseFieldRef(ref)?.field}:${parseFieldRef(ref)?.pivot}]" .../> and point the <tooltip> ` +
            `at ${fixRef}. Do not put none:/derivation="None" dimensions on Tooltip in an aggregated view — tooltip ` +
            'does not join the view grain, so Tableau must ATTR()-wrap it.',
        });
      }
    }
    return issues;
  },
};
