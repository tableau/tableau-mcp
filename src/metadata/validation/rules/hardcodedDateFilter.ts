import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

const DATE_LITERAL = /#\s*\d{4}-\d{2}-\d{2}/;

export const hardcodedDateFilterRule: ValidationRule = {
  id: 'hardcoded-date-filter',
  description:
    'Warns when a filter uses a fixed start/end DATE range (literal #YYYY-MM-DD# in <min>/<max>). A hardcoded date ' +
    'range returns no data once time passes it, leaving a blank dashboard. Prefer a relative date range.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const filters = xpath.select('//filter[min or max]', doc as unknown as Node) as Element[];
    const issues: ValidationIssue[] = [];

    for (const filter of filters) {
      const minText = xpath.select('string(min)', filter as unknown as Node) as string;
      const maxText = xpath.select('string(max)', filter as unknown as Node) as string;
      if (!DATE_LITERAL.test(minText) && !DATE_LITERAL.test(maxText)) continue;

      const column = filter.getAttribute('column') ?? '(unknown field)';
      const range = [minText.trim(), maxText.trim()].filter(Boolean).join(' → ');
      issues.push({
        ruleId: 'hardcoded-date-filter',
        severity: 'warning',
        message:
          `Filter on "${column}" uses a hardcoded date range (${range}). A fixed start/end date returns no data ` +
          'once time moves past the end date — users see a blank dashboard with no explanation. ' +
          'Use a relative date range (last 30 days, last quarter, year to date) so the window follows the data.',
        xpath: '//filter[min or max]',
        suggestion:
          'Replace the fixed #YYYY-MM-DD# min/max with a relative date filter (e.g. last N days / to-date), or a ' +
          'parameter-driven anchor, so the range stays current as new data arrives.',
      });
    }

    return issues;
  },
};
