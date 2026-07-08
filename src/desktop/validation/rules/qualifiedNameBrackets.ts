/**
 * Validation rule: qualified-name-brackets
 *
 * Tableau field references are bracket-delimited identifiers — `[Field]`,
 * `[Datasource].[Field]`, `[deriv:Field:role]`. A literal `]` inside a name is
 * escaped by DOUBLING it (`]]`); `[` needs no escaping. A doubled/nested opening
 * bracket such as `[[Sub-Category]]` is NOT valid: Tableau parses the trailing
 * `]]` as an escaped literal `]`, so the identifier is never closed and the load
 * is rejected with a blocking modal — "Qualified Name Parse Error --- Invalid
 * input: mismatched brackets --- Input: [Sample - Superstore].[[Sub-Category]]"
 * (observed live on 2026-07-08, apply-workbook).
 *
 * That XML is well-formed (brackets are not XML metacharacters), so the
 * well-formed-xml rule cannot catch it. This preflight turns Desktop's async load
 * rejection into an actionable server-side error naming the exact bad string.
 *
 * Severity: ERROR. A mismatched-bracket qualified name is never intentional — it
 * always fails to load.
 *
 * Precision over recall: only values that are a SINGLE pure qualified-name
 * reference are validated (see isQualifiedNameCandidate). Formula bodies, captions
 * and multi-pill shelf expressions — which legitimately contain unbalanced
 * brackets inside string literals — are deliberately skipped so this rule never
 * false-rejects valid content (e.g. a bundled template).
 */
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

const TEXT_NODE = 3;
const ATTRIBUTE_NODE = 2;

/**
 * Attributes / elements that carry FREE TEXT (calc formulas, captions, rich-text
 * runs) rather than a pure field reference. Their values may legitimately contain
 * unbalanced brackets (string literals like `"x[y"`), so they are never scanned.
 */
const FREE_TEXT_ATTRS = new Set(['formula', 'caption']);
const FREE_TEXT_ELEMENTS = new Set(['calculation', 'run', 'formatted-text', 'text']);

/**
 * Attributes that carry an object's OWN NAME (a user-chosen label), not a field
 * reference, when they sit on one of {@link OBJECT_NAME_ELEMENTS}. A sheet, zone,
 * or window can legally be named `[[Q3]]`; that is not a qualified name and must
 * never be rejected. Field-reference-bearing attributes (`column`, `field`, …) are
 * still scanned everywhere, so `column='[Ds].[[Bad]]'` is still caught.
 */
const OBJECT_NAME_ATTRS = new Set(['name', 'title', 'caption']);
const OBJECT_NAME_ELEMENTS = new Set(['worksheet', 'dashboard', 'zone', 'window']);

/**
 * A candidate is a value that is plausibly a SINGLE pure Tableau qualified name:
 * it is bracket-delimited at both ends and contains none of the characters that
 * mark a formula or a multi-reference expression. This admits the malformed
 * `[X].[[Y]]` (so it can be flagged) while excluding `SUM([Sales])`, `[Sales] > 5`,
 * and multi-pill shelves like `[a].[b] / [c].[d]`.
 */
function isQualifiedNameCandidate(value: string): boolean {
  if (!value.startsWith('[') || !value.endsWith(']')) return false;
  // Any of these outside-bracket characters indicate a formula / multi-ref value,
  // never a single qualified name. (Chars valid INSIDE a name — spaces, '-', '.',
  // ':', '&', etc. — are intentionally allowed.)
  return !/["()\n\r\t/+*,=<>]/.test(value);
}

/**
 * True when `value` is a well-formed Tableau qualified name: a `.`-separated
 * sequence of bracket identifiers, where a `]` inside an identifier is escaped as
 * `]]`. Returns false for a doubled/nested opener that leaves an identifier
 * unterminated (the mismatched-brackets defect).
 */
function isWellFormedQualifiedName(value: string): boolean {
  let i = 0;
  const n = value.length;
  while (true) {
    if (value[i] !== '[') return false;
    i++; // consume '['
    let closed = false;
    while (i < n) {
      if (value[i] === ']') {
        if (value[i + 1] === ']') {
          i += 2; // escaped literal ']'
          continue;
        }
        i++; // real closing bracket
        closed = true;
        break;
      }
      i++; // identifier content (incl. a literal '[', which Tableau allows)
    }
    if (!closed) return false; // unterminated identifier → mismatched brackets
    if (i === n) return true; // ended right after a complete segment
    if (value[i] === '.') {
      i++; // segment separator → parse the next segment
      continue;
    }
    return false; // trailing junk after a complete segment
  }
}

function issueFor(value: string): ValidationIssue {
  return {
    ruleId: 'qualified-name-brackets',
    severity: 'error',
    message:
      `Malformed qualified name ${JSON.stringify(value)}: the brackets are mismatched ` +
      '(an identifier is left unterminated — a doubled/nested bracket like [[Field]] is the ' +
      'usual cause). Tableau rejects this on load with "Qualified Name Parse Error --- ' +
      'mismatched brackets". Write each identifier as a single bracket pair, e.g. ' +
      '[Datasource].[Field] — brackets are not nested. To include a literal ] inside a name, ' +
      'double it as ]].',
    xpath: `//*[contains(., ${JSON.stringify(value)})]`,
    suggestion:
      'Write [Datasource].[Field] with a single bracket pair per identifier; brackets are not ' +
      'nested. Escape a literal ] inside a name by doubling it (]]).',
  };
}

export const qualifiedNameBracketsRule: ValidationRule = {
  id: 'qualified-name-brackets',
  description:
    'Rejects field references whose brackets are mismatched/nested (e.g. [[Sub-Category]]); ' +
    'Tableau rejects these on load with a "Qualified Name Parse Error --- mismatched brackets" ' +
    'modal that the well-formed-xml rule cannot catch.',
  contexts: ['workbook', 'worksheet', 'dashboard', 'datasource'],

  validate(xml: string): ValidationIssue[] {
    // Suppress parser error output; malformed XML is reported by well-formed-xml.
    let doc: Document;
    try {
      const parser = new DOMParser({ errorHandler: () => {} });
      doc = parser.parseFromString(xml.trim() || '<empty/>', 'text/xml') as unknown as Document;
    } catch {
      return [];
    }

    const nodes = xpath.select('//@* | //text()', doc as unknown as Node) as Node[];
    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();

    for (const node of nodes) {
      let value: string | undefined;

      if (node.nodeType === ATTRIBUTE_NODE) {
        const attr = node as Attr;
        if (FREE_TEXT_ATTRS.has(attr.name)) continue;
        // Skip object-name labels (a sheet/zone/window/dashboard literally named
        // "[[Q3]]") — those are not field references and must not be rejected.
        const owner = attr.ownerElement;
        if (OBJECT_NAME_ATTRS.has(attr.name) && owner && OBJECT_NAME_ELEMENTS.has(owner.nodeName)) {
          continue;
        }
        value = attr.value;
      } else if (node.nodeType === TEXT_NODE) {
        const parent = (node as Text).parentNode as Element | null;
        if (parent && FREE_TEXT_ELEMENTS.has(parent.nodeName)) continue;
        value = (node as Text).data;
      }

      if (!value) continue;
      const trimmed = value.trim();
      if (!isQualifiedNameCandidate(trimmed)) continue;
      if (isWellFormedQualifiedName(trimmed)) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      issues.push(issueFor(trimmed));
    }

    return issues;
  },
};
