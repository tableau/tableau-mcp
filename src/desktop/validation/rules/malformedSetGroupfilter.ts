import type { ValidationIssue, ValidationRule } from '../types.js';

const GROUP_BLOCK = /<group\b[^>]*>[\s\S]*?<\/group>/gi;
const GROUP_OPEN = /<group\b[^>]*>/i;
const GROUPFILTER_FILTER = /<groupfilter\b[^>]*\bfunction=(['"])filter\1/i;
const NAME_ATTR = /\bname=(['"])(.*?)\1/i;

export const malformedSetGroupfilterRule: ValidationRule = {
  id: 'malformed-set-groupfilter',
  description:
    "Errors when a <group> (set) uses a flat <groupfilter function='filter'> membership spec instead of the nested " +
    "end/order/level-members form. Tableau cannot parse it and DELETES the set on reload ('Error parsing set … deleting set'), " +
    'breaking dependent calcs. Use the nested top-N groupfilter recipe.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    for (const match of String(xml ?? '').matchAll(GROUP_BLOCK)) {
      const block = match[0];
      if (!GROUPFILTER_FILTER.test(block)) continue;

      const open = GROUP_OPEN.exec(block)?.[0] ?? '';
      const name = NAME_ATTR.exec(open)?.[2] ?? '(unnamed)';
      issues.push({
        ruleId: 'malformed-set-groupfilter',
        severity: 'error',
        message:
          `The set ${name} uses a FLAT <groupfilter function='filter'> membership spec (the viz-filter form). ` +
          `Tableau cannot parse this as a set and reports "Error parsing set '${name}', deleting set" on reload — ` +
          'the set is DELETED and every calc that depends on it breaks (the worksheet shows shelves but no marks).',
        xpath: `//group[@name='${name}']/groupfilter[@function='filter']`,
        suggestion:
          "Use the nested top-N set recipe instead of function='filter': " +
          `<group caption='…' name='${name}' name-style='unqualified'>` +
          "<groupfilter count='[Parameters].[<N-param>]' end='top' function='end' units='records'>" +
          "<groupfilter direction='DESC' expression='SUM([Profit])' function='order'>" +
          "<groupfilter function='level-members' level='[Sub-Category]'/></groupfilter></groupfilter></group> " +
          "(end='bottom' + direction='ASC' for the bottom set).",
      });
    }

    return issues;
  },
};
