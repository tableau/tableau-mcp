/**
 * Validation rule: calc-field-names
 *
 * Checks that calculated field `name` attributes follow the naming convention
 * Tableau Desktop expects for datasource-level columns.
 *
 * STATUS: Downgraded to warning-only (telemetry/evidence-gathering mode).
 * This rule was initially severity: "error" but produced false positives on
 * parameters, bins, auto-columns, and Tableau's copy-pattern fields. It is
 * warning-only until failure-capture data confirms which specific naming
 * patterns actually cause Tableau Desktop failures vs. which are benign.
 *
 * PROMOTION CRITERIA: To promote any case back to severity: "error", you need:
 *   1. At least N failure-capture artifacts showing the same naming pattern
 *      correlated with a Tableau Desktop apply failure (not just a red icon)
 *   2. A test case proving the specific construct is rejected by Tableau
 *   3. Exemptions for known-good non-Calculation patterns (parameters, bins, etc.)
 *
 * ORIGINAL OBSERVATION: [R Score] at datasource level correlated with a
 * red error state in the data pane. Correlation observed, causation not
 * confirmed — the symptom may have been caused by formula errors, missing
 * dependencies, or other factors coincident with the non-standard name.
 * Do not treat this as a formally verified Tableau constraint.
 */

import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

/**
 * Initial heuristic for valid datasource-level calc field names.
 * Matches: [Calculation_123], [Calculation_20260414_001], [Calculation_abc_def]
 * Does NOT match: [R Score], [My Calc], [Calculation] (no suffix)
 *
 * Labeled as heuristic: refine based on failure-capture data if false positives
 * or false negatives emerge.
 */
const DATASOURCE_CALC_NAME_HEURISTIC = /^\[Calculation_[A-Za-z0-9_]+\]$/;

function isDatasourceLevel(node: Element): boolean {
  // A column is datasource-level if its closest <datasource> ancestor
  // is NOT inside a <datasource-dependencies> element.
  let parent = node.parentNode as Element | null;
  let insideDatasourceDeps = false;

  // Stop walking at any known document root. Worksheet XML has <worksheet> as
  // its root, not <workbook>, so both must be listed as terminal conditions.
  while (
    parent &&
    parent.nodeType === 1 /* ELEMENT_NODE */ &&
    parent.nodeName !== 'workbook' &&
    parent.nodeName !== 'worksheet'
  ) {
    if (parent.nodeName === 'datasource-dependencies') {
      insideDatasourceDeps = true;
      break;
    }
    parent = parent.parentNode as Element | null;
  }

  return !insideDatasourceDeps;
}

export const calcFieldNamesRule: ValidationRule = {
  id: 'calc-field-names',
  description:
    'Datasource-level calc fields should use [Calculation_*] internal names (warning-only telemetry; see STATUS comment)',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Suppress parser error output; malformed XML is reported upstream.
    let doc: Document;
    try {
      const parser = new DOMParser({
        errorHandler: (_level, _msg, _context) => {},
      });
      doc = parser.parseFromString(xml.trim(), 'text/xml') as unknown as Document;
    } catch {
      return [];
    }

    // Find all <column> elements that contain a <calculation> child
    const columns = xpath.select('//column[calculation]', doc as unknown as Node) as Element[];

    for (const col of columns) {
      const name = col.getAttribute('name');
      if (!name) continue;

      if (isDatasourceLevel(col)) {
        if (!DATASOURCE_CALC_NAME_HEURISTIC.test(name)) {
          issues.push({
            ruleId: 'calc-field-names',
            severity: 'warning',
            message:
              `Non-standard internal name detected (telemetry only): ${name}. ` +
              'If this field works correctly in Tableau, this warning can be ignored. ' +
              '[Calculation_*] format is always safe for datasource-level calc fields.',
            xpath: `//column[@name="${name}"]`,
            suggestion:
              `Rename to [Calculation_<id>] format (e.g. [Calculation_${Date.now()}]) ` +
              'and move the display name to the caption attribute.',
          });
        }
      } else {
        // Worksheet-level (inside datasource-dependencies): warn only.
        // Inline calcs are more flexible but [Calculation_*] is always safe.
        if (!DATASOURCE_CALC_NAME_HEURISTIC.test(name)) {
          issues.push({
            ruleId: 'calc-field-names',
            severity: 'warning',
            message:
              `Worksheet-level calc field uses a non-standard internal name: ${name}. ` +
              'This may be fine for inline calcs, but [Calculation_*] format is always safe.',
            xpath: `//datasource-dependencies//column[@name="${name}"]`,
          });
        }
      }
    }

    return issues;
  },
};
