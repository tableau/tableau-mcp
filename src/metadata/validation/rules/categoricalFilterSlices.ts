import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

function localFieldName(columnRef: string): string {
  const lastBracket = [...columnRef.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).pop() ?? columnRef;
  const unwrapped = lastBracket.replace(/^\[|\]$/g, '');
  const ci = unwrapped.match(/^[a-z0-9]+:(.*):[a-z]+$/i);
  return (ci ? ci[1] : unwrapped).replace(/^:/, '').trim().toLowerCase();
}

function isTableCalcCiRef(columnRef: string): boolean {
  const lastBracket = [...columnRef.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]).pop() ?? columnRef;
  const unwrapped = lastBracket.replace(/^\[|\]$/g, '');
  return /^usr:/i.test(unwrapped);
}

export const categoricalFilterSlicesRule: ValidationRule = {
  id: 'categorical-filter-slices',
  description:
    'Warns when a categorical filter lacks a matching <slices><column> entry; missing slices can make Tableau strip filters on round-trip.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const sliceColumns = [
      ...(
        xpath.select(
          '//slices/column/@column | //slices/column/@name',
          doc as unknown as Node,
        ) as Attr[]
      ).map((a) => a.value),
      ...(xpath.select('//slices/column/text()', doc as unknown as Node) as Node[]).map(
        (node) => node.nodeValue ?? '',
      ),
    ]
      .filter(Boolean)
      .map((value) => localFieldName(value));

    const issues: ValidationIssue[] = [];

    const categoricalFilters = xpath.select(
      "//filter[@class='categorical'][@column]",
      doc as unknown as Node,
    ) as Element[];
    for (const filter of categoricalFilters) {
      const column = filter.getAttribute('column') ?? '';
      if (sliceColumns.includes(localFieldName(column))) continue;
      issues.push({
        ruleId: 'categorical-filter-slices',
        severity: 'warning',
        message:
          `Categorical filter on "${column}" has no matching <slices><column> entry. ` +
          'Tableau may silently strip this filter on round-trip. Add a slices column for the same field before relying on the filter.',
        xpath: "//filter[@class='categorical'][@column]",
        suggestion:
          'Add a matching <slices><column> entry for the categorical filter field, preserving the exact datasource/field binding.',
      });
    }

    const quantitativeFilters = xpath.select(
      "//filter[@class='quantitative'][@column]",
      doc as unknown as Node,
    ) as Element[];
    for (const filter of quantitativeFilters) {
      const column = filter.getAttribute('column') ?? '';
      if (!isTableCalcCiRef(column)) continue;
      if (sliceColumns.includes(localFieldName(column))) continue;
      issues.push({
        ruleId: 'categorical-filter-slices',
        severity: 'warning',
        message:
          `Table-calc filter on "${column}" has no matching <slices><column> entry. ` +
          'A table-calc column-instance used as a quantitative (range) filter is silently stripped on round-trip ' +
          'without a matching slices entry — same requirement as categorical filters. Add a <slices><column> for this CI.',
        xpath: "//filter[@class='quantitative'][@column]",
        suggestion:
          'Add a matching <slices><column> entry referencing the table-calc filter CI (e.g. the continuous usr: instance).',
      });
    }

    return issues;
  },
};

export { localFieldName as normalizeFilterColumnForSlices };
