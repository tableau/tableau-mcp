/**
 * Validation rule: undeclared-aggregate-ok-ref
 *
 * An aggregate column-instance uses the quantitative-key pivot — the canonical
 * measure reference is `[sum:Sales:qk]` (knowledge: tactics/tree/column-instance-prefixes).
 * An aggregate ref with the ORDINAL suffix (`[sum:Sales:ok]`) is only valid when a
 * matching `<column-instance name='[sum:Sales:ok]' … type='ordinal'>` is deliberately
 * declared. An UNDECLARED aggregate `:ok` ref makes Desktop log "Unknown column
 * [sum:Sales:ok]" and render the pill wrong or blank, with no load error.
 *
 * Isolated 2026-07-09 (Laulima day-1 live dogfood): Desktop logged the unknown-column
 * error 21× during an agent-built dashboard whose heatmap rendered wrong values.
 * Ported from agent-to-tableau-desktop (a2td 028f87d + bcdf057 review fixups).
 *
 * Severity: WARNING — a declared discrete aggregate instance is legitimate, and
 * Tableau tolerates some undeclared shelf refs by deriving the instance; only the
 * undeclared shape is flagged, as the strong "Unknown column" predictor. Declarations
 * are matched payload-wide, not per-datasource (false-negative direction only).
 */
import type { ValidationIssue, ValidationRule } from '../types.js';

// Aggregate CI prefixes from the authoritative derivation table.
const AGG_OK_REF = /\[(sum|avg|cnt|ctd|med|min|max|std|stp|var|vrp):([^:\]]+):ok\]/gi;

// <column-instance …> open tags; only the open tag carries name=.
const COLUMN_INSTANCE_TAG = /<column-instance\b[^>]*>/gi;
const NAME_ATTR = /\bname\s*=\s*(?:'([^']*)'|"([^"]*)")/;

export const undeclaredAggregateOkRefRule: ValidationRule = {
  id: 'undeclared-aggregate-ok-ref',
  description:
    'Warns when an aggregate column-instance reference uses the ordinal suffix (e.g. [sum:Sales:ok]) without a ' +
    "matching declared <column-instance> — Desktop logs 'Unknown column' and renders the pill wrong or blank. " +
    'The canonical measure reference is [sum:Sales:qk].',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    const issues: ValidationIssue[] = [];

    const declared = new Set<string>();
    for (const m of s.matchAll(COLUMN_INSTANCE_TAG)) {
      const nm = NAME_ATTR.exec(m[0]);
      const name = nm ? (nm[1] ?? nm[2]) : '';
      if (name) declared.add(name.toLowerCase());
    }

    const issued = new Set<string>();
    for (const m of s.matchAll(AGG_OK_REF)) {
      const ref = m[0];
      const key = ref.toLowerCase();
      if (declared.has(key) || issued.has(key)) continue;
      issued.add(key);
      const prefix = m[1];
      const field = m[2].trim();
      issues.push({
        ruleId: 'undeclared-aggregate-ok-ref',
        severity: 'warning',
        message:
          `Aggregate column-instance reference ${ref} uses the ordinal suffix (:ok) but no matching ` +
          `<column-instance name="${ref}"> is declared — Desktop logs "Unknown column ${ref}" and the field ` +
          'renders wrong or blank, with no load error.',
        xpath: `//*[contains(text(),'${ref}')] | //@*[contains(.,'${ref}')]`,
        suggestion:
          `Use the canonical quantitative measure instance [${prefix}:${field}:qk], or — if a discrete aggregate ` +
          `is intended — declare <column-instance name='${ref}' … type='ordinal'> in the owning ` +
          'datasource-dependencies block.',
      });
    }
    return issues;
  },
};
