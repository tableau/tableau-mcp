import type { ValidationIssue, ValidationRule } from '../types.js';

const GROUP_BLOCK = /<group\b[^>]*>[\s\S]*?<\/group>/gi;
const GROUP_OPEN = /<group\b[^>]*>/i;
// Match a function='filter' groupfilter tag (self-closing or open), scanning its attributes in a
// QUOTE-AWARE way: an attribute region is a run of non-delimiter chars OR a fully quoted span.
const ATTR_RUN = '(?:[^>\'"]|\'[^\']*\'|"[^"]*")*';
const FILTER_TAG = new RegExp(
  `<groupfilter\\b${ATTR_RUN}\\bfunction=(['"])filter\\1${ATTR_RUN}\\/?>`,
  'gi',
);
const NAME_ATTR = /\bname=(['"])(.*?)\1/i;
const LEADING_COMMENTS = /^(?:\s*<!--[\s\S]*?-->)*\s*/;

// A set's function='filter' groupfilter is only well-formed when it WRAPS a nested
// <groupfilter> (the enumerate / level-members child). The flat form — self-closing,
// or an empty <groupfilter function='filter'></groupfilter> — has no child; Tableau's
// parser throws IncorrectInputSize and DELETES the set on reload. The valid nested
// condition set (function='filter' + a level-members child) must NOT be flagged..
function hasFlatFilterGroupfilter(block: string): boolean {
  for (const match of block.matchAll(FILTER_TAG)) {
    const tag = match[0];
    const isSelfClosing = /\/\s*>$/.test(tag);
    if (isSelfClosing) {
      return true;
    }
    const after = block.slice(match.index + tag.length).replace(LEADING_COMMENTS, '');
    if (!/^<groupfilter\b/i.test(after)) {
      return true;
    }
  }
  return false;
}

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
      if (!hasFlatFilterGroupfilter(block)) continue;

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
          "Wrap the function='filter' groupfilter around a nested child instead of leaving it flat. " +
          'For a condition (rule-based) set: ' +
          `<group caption='…' name='${name}' name-style='unqualified' user:ui-builder='filter-group'>` +
          "<groupfilter expression='SUM([Sales])&gt;=60000' function='filter' user:ui-filter-by-field='true' user:ui-marker='filter-by'>" +
          "<groupfilter function='level-members' level='[City]' user:ui-enumeration='all' user:ui-marker='enumerate'/></groupfilter></group>. " +
          'Or the nested top-N recipe: ' +
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
