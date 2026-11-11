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

const FILTER_ELEMENTS_XPATH = '//groupfilter[not(ancestor::group)][@count]';

function elementName(element: Element): string {
  return element.localName || element.tagName;
}

function elementPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current) {
    const name = elementName(current);
    const parent: ParentNode | null = current.parentNode;
    const siblings =
      parent === null
        ? [current]
        : Array.from(parent.childNodes).filter(
            (node: Node): node is Element =>
              node.nodeType === 1 && elementName(node as Element) === name,
          );
    segments.unshift(`${name}[${siblings.indexOf(current) + 1}]`);
    current = parent?.nodeType === 1 ? (parent as Element) : null;
  }
  return `/${segments.join('/')}`;
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
      const rawValue = element.getAttribute('count')?.trim() ?? '';
      if (rawValue === '') continue;

      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue) || numericValue > 0) continue;

      const nodeName = elementName(element);
      issues.push({
        ruleId: 'non-positive-filter-count',
        severity: 'error',
        message:
          `<${nodeName}> count="${rawValue}" is not greater than zero. ` +
          'Tableau Desktop rejects this filter limit with blocking modal AC6CC624 ' +
          '("The filter limit must be greater than zero").',
        xpath: elementPath(element),
        suggestion:
          'Set count to a literal value of at least 1, or reference a parameter whose value is always positive.',
      });
    }

    return issues;
  },
};
