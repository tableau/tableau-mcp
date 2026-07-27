/**
 * Validation rule: non-positive-filter-count
 *
 * Tableau Desktop rejects non-positive filter limits with blocking modal
 * AC6CC624 ("The filter limit must be greater than zero"). Catch literal
 * count values before any posted-XML apply reaches Desktop.
 */
import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const FILTER_ELEMENTS_XPATH =
  "//*[contains(translate(local-name(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'filter')]";

function elementName(element: Element): string {
  return element.localName || element.tagName;
}

function countAttributes(element: Element): Attr[] {
  return Array.from(element.attributes).filter((attribute) => {
    const name = (attribute.localName || attribute.name).toLowerCase();
    return name === 'count';
  });
}

export const nonPositiveFilterCountRule: ValidationRule = {
  id: 'non-positive-filter-count',
  description:
    'Errors when a filter node has a literal count that is zero or negative, which Tableau rejects with AC6CC624.',
  contexts: ['workbook', 'worksheet', 'dashboard'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const filterElements = xpath.select(FILTER_ELEMENTS_XPATH, doc as unknown as Node) as Element[];
    const issues: ValidationIssue[] = [];

    for (const element of filterElements) {
      for (const attribute of countAttributes(element)) {
        const rawValue = attribute.value.trim();
        if (rawValue === '') continue;

        const numericValue = Number(rawValue);
        if (!Number.isFinite(numericValue) || numericValue > 0) continue;

        const nodeName = elementName(element);
        const attributeName = attribute.localName || attribute.name;
        issues.push({
          ruleId: 'non-positive-filter-count',
          severity: 'error',
          message:
            `<${nodeName}> ${attributeName}="${rawValue}" is not greater than zero. ` +
            'Tableau Desktop rejects this filter limit with blocking modal AC6CC624 ' +
            '("The filter limit must be greater than zero").',
          xpath: `//*[contains(local-name(), 'filter')][@${attributeName}]`,
          suggestion: `Set ${attributeName} to a literal value of at least 1, or reference a parameter whose value is always positive.`,
        });
      }
    }

    return issues;
  },
};
