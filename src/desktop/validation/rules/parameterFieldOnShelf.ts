import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const PARAMETERS_FIELD = /\[Parameters\]\.\[[^\]]+\]/;

export const parameterFieldOnShelfRule: ValidationRule = {
  id: 'parameter-field-on-shelf',
  description:
    'Errors when a [Parameters] field is placed directly on a worksheet shelf (rows/cols) — the Parameters ' +
    'pseudo-datasource has no connection, so the worksheet has no valid data source and Tableau rejects the apply. ' +
    'Build selector sheets from a real dimension and map it to the parameter via a parameter action instead.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();
    const shelves = xpath.select('//rows/text() | //cols/text()', doc as unknown as Node) as Node[];
    for (const node of shelves) {
      const value = String(node.nodeValue ?? '');
      const match = value.match(PARAMETERS_FIELD);
      if (!match) continue;
      const ref = match[0];
      if (seen.has(ref)) continue;
      seen.add(ref);
      issues.push({
        ruleId: 'parameter-field-on-shelf',
        severity: 'error',
        message:
          `A [Parameters] field (${ref}) is placed on a worksheet shelf (rows/cols). The Parameters datasource ` +
          'has no connection, so the worksheet has no valid data source and Tableau rejects the apply ' +
          '("the worksheet does not have a valid data source").',
        xpath: '//rows/text() | //cols/text()',
        suggestion:
          "Don't put the parameter on a shelf. To build a clickable selector, bind the sheet to the REAL datasource " +
          "and place a real discrete dimension whose members map to the parameter's options (e.g. " +
          '[Sample - Superstore].[:Measure Names] filtered to the period members, or a small string-dimension calc), ' +
          "then map THAT field to the parameter via a parameter action's source-field — the parameter is the action's " +
          "TARGET, never the source mark's field. See expertise://tableau/tactics/dashboard/parameter-actions.",
      });
    }
    return issues;
  },
};
