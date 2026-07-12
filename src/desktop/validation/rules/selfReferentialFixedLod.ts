import type { ValidationIssue, ValidationRule } from '../types.js';

const FIXED_LOD = /\{\s*FIXED\b[^}]*\}/gi;
const NESTED_FIXED = /\{\s*FIXED\b[^{}]*\{\s*FIXED\b/i;

export const selfReferentialFixedLodRule: ValidationRule = {
  id: 'self-referential-fixed-lod',
  description:
    'Warns (blocking) when a calc hand-rolls top-N/bottom-N membership by nesting/ comparing FIXED LODs over the same ' +
    "dimension — a self-referential LOD that evaluates to a constant and won't partition or re-rank. Use two Top-tab " +
    'sets driven by the parameter + a label calc instead (see sets-usage-and-creation).',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const formulas = [...String(xml ?? '').matchAll(/formula=(['"])([\s\S]*?)\1/gi)].map(
      (m) => m[2] ?? '',
    );
    const issues: ValidationIssue[] = [];

    for (const formula of formulas) {
      const fixedCount = (formula.match(FIXED_LOD) || []).length;
      const nested = NESTED_FIXED.test(formula);
      const rankTell = /\bCOUNTD?\s*\(|>=|<=|\bRANK\b/i.test(formula);
      if (!(nested || fixedCount >= 2) || !rankTell) continue;

      issues.push({
        ruleId: 'self-referential-fixed-lod',
        severity: 'error',
        message:
          'This calc computes top/bottom-N membership by nesting or comparing FIXED LODs over the same dimension ' +
          `(${fixedCount} FIXED expression(s)${nested ? ', nested' : ''}). A FIXED LOD over a member evaluates to a ` +
          "per-member constant, so the comparison is constant — membership won't partition and won't re-rank when the " +
          'parameter or period changes. This is a known dead-end approach.',
        xpath: '//calculation/@formula',
        suggestion:
          'Do NOT hand-roll membership with FIXED LODs (or RANK/PERCENTILE). Use the WOW W44 construct: TWO Top-tab ' +
          "sets on the dimension — one end='top', one end='bottom', both counting by the parameter and ordering by " +
          'the (period) measure — then a label calc (IF [TopSet] THEN "Top" ELSEIF [BottomSet] THEN "Bottom" ELSE ' +
          '"Everyone Else" END). Put that label on the grain to roll the middle into one bar. ' +
          'See expertise://tableau/tactics/data/sets-usage-and-creation ("Top AND Bottom N driven by a parameter").',
      });
    }

    return issues;
  },
};
