import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';

export const duplicateEmptyParameterRule: ValidationRule = {
  id: 'duplicate-empty-parameter',
  description:
    'Flags a parameter <column> declared twice under the same name where one copy is an empty stub (no value= attribute). ' +
    'Tableau rejects the workbook load with "value - empty text". Keep a single, complete parameter definition.',
  contexts: ['workbook'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc?.documentElement) return [];

    const paramCols = xpath.select(
      '//column[@param-domain-type]',
      doc as unknown as Node,
    ) as Element[];
    if (paramCols.length < 2) return [];

    const byName = new Map<string, Element[]>();
    for (const col of paramCols) {
      const name = col.getAttribute('name') ?? '';
      if (!name) continue;
      const list = byName.get(name) ?? [];
      list.push(col);
      byName.set(name, list);
    }

    const issues: ValidationIssue[] = [];
    for (const [name, cols] of byName) {
      if (cols.length < 2) continue;
      const hasValue = cols.some(
        (col) => col.getAttribute('value') !== null && col.getAttribute('value') !== '',
      );
      const hasEmpty = cols.some(
        (col) => col.getAttribute('value') === null || col.getAttribute('value') === '',
      );
      if (!hasValue || !hasEmpty) continue;

      issues.push({
        ruleId: 'duplicate-empty-parameter',
        severity: 'error',
        message:
          `Parameter ${name} is declared ${cols.length}x in the Parameters block, and at least one copy is an empty stub (no value= attribute). ` +
          'Tableau REJECTS the workbook load with "value - empty text" (the whole apply silently fails; the agent thinks it succeeded).',
        xpath: `//column[@param-domain-type][@name='${name}']`,
        suggestion:
          `Declare the parameter ${name} exactly ONCE, with its value= and nested <calculation>/<range>. ` +
          `Remove the empty duplicate <column name="${name}" .../> stub.`,
      });
    }

    return issues;
  },
};

function parseXml(xml: string): Document | null {
  try {
    return new DOMParser({ errorHandler: () => {} }).parseFromString(
      String(xml ?? '').trim() || '<empty/>',
      'text/xml',
    ) as unknown as Document;
  } catch {
    return null;
  }
}
