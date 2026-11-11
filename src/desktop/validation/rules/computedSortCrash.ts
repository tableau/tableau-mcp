import * as xpath from 'xpath';

import type { ValidationIssue, ValidationRule } from '../types.js';
import { parseXml } from './parseXml.js';

export const computedSortCrashRule: ValidationRule = {
  id: 'computed-sort-crash',
  description:
    "Flags a <sort class='computed-sort'> that nests a <sort-computation> child — that form crashes Tableau Desktop on apply " +
    "(internal logic-assert). Use the self-closing inline <computed-sort ... using='...'/> form instead.",
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const doc = parseXml(xml);
    if (!doc) return [];

    const crashing = xpath.select(
      "//sort[(@class='computed-sort' or @class='computed')][.//sort-computation or .//sort-expression]",
      doc as unknown as Node,
    ) as Element[];
    if (crashing.length === 0) return [];

    const sort = crashing[0];
    const column = sort.getAttribute('column') ?? '';
    const cls = sort.getAttribute('class') ?? 'computed-sort';
    const nestedChild =
      (xpath.select('count(.//sort-computation)', sort as unknown as Node) as number) > 0
        ? 'sort-computation'
        : 'sort-expression';
    const comp =
      (xpath.select('string(.//sort-computation/@field)', sort as unknown as Node) as string) ||
      (xpath.select(
        'string(.//sort-expression//expression[not(*)])',
        sort as unknown as Node,
      ) as string) ||
      '';
    const dir = sort.getAttribute('direction') || 'DESC';

    return [
      {
        ruleId: 'computed-sort-crash',
        severity: 'error',
        message:
          `<sort class="${cls}"> with a nested <${nestedChild}> is present (column ${column}). ` +
          (cls === 'computed-sort' && nestedChild === 'sort-computation'
            ? 'This form CRASHES Tableau Desktop on apply (internal logic-assert) — the whole session is lost, not just a failed apply.'
            : 'Tableau cannot resolve the sort-by from the nested child and reports "sorted on undefined field, ignoring sort" — a blocking "Unable to complete action" popup that silently drops the sort.'),
        xpath:
          "//sort[(@class='computed-sort' or @class='computed')][.//sort-computation or .//sort-expression]",
        suggestion:
          'Use the self-closing inline form instead: ' +
          `<computed-sort column="${column}" direction="${dir}" using="${comp || '[ds].[agg:Field:qk]'}"/> ` +
          '(no <sort-computation> child). This expresses the same profit-ordered sort and applies safely.',
      },
    ];
  },
};
