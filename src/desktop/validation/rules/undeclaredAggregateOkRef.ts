import type { ValidationIssue, ValidationRule } from '../types.js';

const AGG_OK_REF = /\[(sum|avg|cnt|ctd|med|min|max|std|stp|var|vrp):([^:\]]+):ok\]/gi;
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
    const declared = new Set<string>();
    for (const match of s.matchAll(COLUMN_INSTANCE_TAG)) {
      const nameMatch = NAME_ATTR.exec(match[0]);
      const name = nameMatch ? (nameMatch[1] ?? nameMatch[2]) : '';
      if (name) declared.add(name.toLowerCase());
    }

    const issues: ValidationIssue[] = [];
    const issued = new Set<string>();
    for (const match of s.matchAll(AGG_OK_REF)) {
      const ref = match[0];
      const key = ref.toLowerCase();
      if (declared.has(key) || issued.has(key)) continue;
      issued.add(key);

      const prefix = match[1];
      const field = match[2].trim();
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
