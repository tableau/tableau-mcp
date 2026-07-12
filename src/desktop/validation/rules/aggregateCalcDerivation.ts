import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const AGG_FUNCS = [
  'SUM',
  'AVG',
  'COUNTD',
  'COUNT',
  'MEDIAN',
  'MIN',
  'MAX',
  'STDEVP',
  'STDEV',
  'VARP',
  'VAR',
  'ATTR',
  'CORR',
  'COVARP',
  'COVAR',
  'PERCENTILE',
];

const TABLE_CALC_FUNCS = [
  'INDEX',
  'SIZE',
  'FIRST',
  'LAST',
  'RANK_DENSE',
  'RANK_MODIFIED',
  'RANK_PERCENTILE',
  'RANK_UNIQUE',
  'RANK',
  'LOOKUP',
  'TOTAL',
  'PREVIOUS_VALUE',
  'RUNNING_SUM',
  'RUNNING_AVG',
  'RUNNING_MIN',
  'RUNNING_MAX',
  'RUNNING_COUNT',
  'WINDOW_SUM',
  'WINDOW_AVG',
  'WINDOW_MIN',
  'WINDOW_MAX',
  'WINDOW_COUNT',
  'WINDOW_MEDIAN',
  'WINDOW_STDEV',
  'WINDOW_STDEVP',
  'WINDOW_VARP',
  'WINDOW_VAR',
  'WINDOW_PERCENTILE',
  'WINDOW_CORR',
  'WINDOW_COVAR',
];

const AGG_RE = new RegExp(`\\b(${AGG_FUNCS.join('|')})\\s*\\(`, 'i');
const TABLE_CALC_RE = new RegExp(`\\b(${TABLE_CALC_FUNCS.join('|')})\\s*\\(`, 'i');

function stripLodBlocks(formula: string): string {
  let prev: string;
  let out = formula;
  do {
    prev = out;
    out = out.replace(/\{[^{}]*\}/g, ' ');
  } while (out !== prev);
  return out;
}

function isAggregateOrTableCalc(formula: string): boolean {
  if (TABLE_CALC_RE.test(formula)) return true;
  return AGG_RE.test(stripLodBlocks(formula));
}

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
          `with the usr: prefix; with none: the viz renders blank (Tableau accepts the XML but produces no marks). ` +
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
