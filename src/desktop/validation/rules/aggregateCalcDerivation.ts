import * as xpath from 'xpath';

import { isAggregateOrTableCalc } from '../../metadata/calculation-classifier.js';
import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

function isNoneDerivation(ci: Element): boolean {
  const derivation = ci.getAttribute('derivation');
  if (derivation === 'None') return true;
  if (derivation === null || derivation === '') {
    return /\[?none:/i.test(ci.getAttribute('name') ?? '');
  }
  return false;
}

export const aggregateCalcDerivationRule: ValidationRule = {
  id: 'aggregate-calc-derivation',
  description:
    'Errors when an aggregate/table-calc calculated field is referenced by a none: (derivation="None") ' +
    'column-instance instead of usr: (derivation="User") — the viz renders blank.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const aggregateCalcNames = new Set<string>();
    const calcColumns = xpath.select('//column[calculation]', doc as unknown as Node) as Element[];
    for (const col of calcColumns) {
      const name = col.getAttribute('name');
      if (!name) continue;
      const calcNodes = xpath.select('calculation', col as unknown as Node) as Element[];
      const formula = calcNodes.map((c) => c.getAttribute('formula') ?? '').join(' ');
      if (isAggregateOrTableCalc(formula)) aggregateCalcNames.add(name);
    }
    if (aggregateCalcNames.size === 0) return [];

    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();
    const cis = xpath.select('//column-instance[@column]', doc as unknown as Node) as Element[];
    for (const ci of cis) {
      const colRef = ci.getAttribute('column') ?? '';
      if (!aggregateCalcNames.has(colRef) || !isNoneDerivation(ci)) continue;

      const ciName = ci.getAttribute('name') ?? '';
      if (seen.has(ciName)) continue;
      seen.add(ciName);

      issues.push({
        ruleId: 'aggregate-calc-derivation',
        severity: 'error',
        message:
          `Aggregate/table-calc calculated field ${colRef} is referenced by a none:/derivation="None" ` +
          `column-instance (${ciName || '(unnamed)'}). An aggregate or table-calc calc must use derivation="User" ` +
          'with the usr: prefix; with none: the viz renders blank (Tableau accepts the XML but produces no marks). ' +
          `Change the column-instance to derivation="User" and name it [usr:${colRef.replace(/^\[|\]$/g, '')}:qk].`,
        xpath: `//column-instance[@column="${colRef}"]`,
        suggestion:
          'Set derivation="User" and use the usr: prefix on the column-instance (e.g. ' +
          `[usr:${colRef.replace(/^\[|\]$/g, '')}:qk]) for this aggregate/table-calc field.`,
      });
    }

    return issues;
  },
};
