import type { ValidationIssue, ValidationRule } from '../types.js';

const SET_LIKE = /\[(Set_[A-Za-z0-9_]+|[A-Za-z0-9_ .-]*\bSet)\]/g;

export const undeclaredSetReferenceRule: ValidationRule = {
  id: 'undeclared-set-reference',
  description:
    "Errors when a calc references a SET ([Set_…] or […Set]) that is never declared as a <group name='[…]'>" +
    ' with a <groupfilter>. The XML applies but Tableau deletes the undefined set on reload ' +
    "('Error parsing set … deleting set'), breaking the calcs that depend on it. Define the set as a <group> before referencing it.",
  contexts: ['workbook'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    const referenced = new Set<string>();

    for (const calc of s.matchAll(/<calculation\b[^>]*\bformula=(['"])((?:(?!\1).)*)\1/gi)) {
      const formula = stripStringLiterals(calc[2] ?? '');
      for (const match of formula.matchAll(SET_LIKE)) referenced.add(match[0]);
    }
    if (referenced.size === 0) return [];

    const issues: ValidationIssue[] = [];
    for (const token of referenced) {
      const name = token.slice(1, -1);
      const groupRe = new RegExp(`<group\\b[^>]*\\bname=(['"])\\[${escapeRe(name)}\\]\\1`, 'i');
      if (groupRe.test(s)) continue;

      const colRe = new RegExp(`<column\\b[^>]*\\bname=(['"])\\[${escapeRe(name)}\\]\\1`, 'i');
      if (colRe.test(s)) continue;

      issues.push({
        ruleId: 'undeclared-set-reference',
        severity: 'error',
        message:
          `The set "${token}" is referenced in a calc formula but never declared as a <group name='${token}'> with a ` +
          `<groupfilter>. The XML applies, but on reload Tableau reports "Error parsing set '${token}', deleting set" and ` +
          'REMOVES it — every calc that depends on it then breaks (the Everyone-Else grouping silently fails).',
        xpath: `//group[@name='${token}']`,
        suggestion:
          'Define the set BEFORE the calc references it. For a top/bottom-N set: ' +
          `<group caption='${name}' name='${token}' name-style='unqualified'>` +
          "<groupfilter count='[Parameters].[<N-param>]' end='top' function='end' units='records'>" +
          "<groupfilter direction='DESC' expression='SUM([Profit])' function='order'>" +
          "<groupfilter function='level-members' level='[Sub-Category]'/></groupfilter></groupfilter></group> " +
          "(end='bottom' for the bottom set). Build BOTH sets, then the label calc that references them.",
      });
    }

    return issues;
  },
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripStringLiterals(formula: string): string {
  return String(formula ?? '')
    .replace(/&quot;[\s\S]*?&quot;/g, '&quot;&quot;')
    .replace(/&apos;[\s\S]*?&apos;/g, '&apos;&apos;')
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''");
}
