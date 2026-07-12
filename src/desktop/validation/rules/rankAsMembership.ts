import type { ValidationIssue, ValidationRule } from '../types.js';

const POSITIONAL_TABLECALC = /\b(RANK(_DENSE|_MODIFIED|_PERCENTILE|_UNIQUE)?|INDEX|FIRST|LAST)\s*\(/i;
const CMP_OP = /(?:<=|>=|<|>|&lt;=|&gt;=|&lt;|&gt;)/;
const POSITIONAL_VS_THRESHOLD = new RegExp(
  `\\b(RANK(_DENSE|_MODIFIED|_PERCENTILE|_UNIQUE)?|INDEX|FIRST|LAST)\\s*\\([\\s\\S]*?\\)\\s*${CMP_OP.source}\\s*[\\s\\S]{0,40}?(\\[Parameters\\]\\.\\[[^\\]]+\\]|\\bSIZE\\s*\\(\\s*\\)|\\d+)`,
  'i',
);
const THEN_STRING_LABEL = /\bTHEN\s*(&quot;|["'])/i;
const FIRST_LAST_VS_ZERO_LABEL = /\b(FIRST|LAST)\s*\(\s*\)\s*(?:<=|>=|<|>|=|&lt;=|&gt;=|&lt;|&gt;)\s*0\b/i;
const FIELD_VS_THRESHOLD = new RegExp(
  `\\[([^\\]]+)\\]\\s*${CMP_OP.source}\\s*[\\s\\S]{0,40}?(\\[Parameters\\]\\.\\[[^\\]]+\\]|\\bSIZE\\s*\\(\\s*\\)|\\d+)`,
  'gi',
);

function calcFormulaMap(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re =
    /<column\b[^>]*\bname=(['"])\[([^\]]+)\]\1[^>]*>\s*<calculation\b[^>]*\bformula=(['"])([\s\S]*?)\3/gi;
  for (const m of xml.matchAll(re)) map.set(m[2], m[4]);
  return map;
}

export const rankAsMembershipRule: ValidationRule = {
  id: 'rank-as-membership',
  description:
    'Warns (blocking) when a calc assigns discrete group MEMBERSHIP by comparing a RANK table-calc to a threshold and ' +
    'branching to string labels (IF RANK(...) <= [p] THEN "Top"…). That\'s the wrong construct — a table calc runs after ' +
    "the grouping is needed, can't be a set-action target, and won't re-rank live. Use the LOD membership tier calc pattern " +
    '(nested LOD percentile thresholds) — see lod-membership-tier-calc. RANK stays correct for a displayed ordinal VALUE.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const s = String(xml ?? '');
    const formulas = [...s.matchAll(/formula=(['"])([\s\S]*?)\1/gi)].map((m) => m[2] ?? '');
    if (formulas.length === 0) return [];

    const calcMap = calcFormulaMap(s);
    const issues: ValidationIssue[] = [];

    for (const formula of formulas) {
      if (!THEN_STRING_LABEL.test(formula)) continue;
      if (FIRST_LAST_VS_ZERO_LABEL.test(formula)) {
        const withoutZeroForm = formula.replace(new RegExp(FIRST_LAST_VS_ZERO_LABEL.source, 'gi'), ' ');
        if (!(POSITIONAL_TABLECALC.test(withoutZeroForm) && POSITIONAL_VS_THRESHOLD.test(withoutZeroForm))) {
          continue;
        }
      }

      const inlineRank = POSITIONAL_TABLECALC.test(formula) && POSITIONAL_VS_THRESHOLD.test(formula);
      let splitRank = false;
      if (!inlineRank) {
        for (const m of formula.matchAll(FIELD_VS_THRESHOLD)) {
          const refName = m[1];
          if (refName.startsWith('Parameters')) continue;
          const refFormula = calcMap.get(refName);
          if (refFormula && POSITIONAL_TABLECALC.test(refFormula)) {
            splitRank = true;
            break;
          }
        }
      }
      if (!inlineRank && !splitRank) continue;

      issues.push({
        ruleId: 'rank-as-membership',
        severity: 'error',
        message:
          'This calc assigns discrete group MEMBERSHIP by comparing a POSITIONAL TABLE CALC (RANK/INDEX/FIRST/LAST) to a ' +
          'threshold and returning string labels (e.g. RANK(...) <op> threshold THEN "<label>", or the twin ' +
          'IF INDEX() <= [N] THEN "Top"). These are all table calcs — they evaluate at Order-of-Operations step 8, ' +
          "AFTER the grouping is needed — so it can't be a set-action target, won't re-rank live when the parameter/period " +
          "changes, and a positional-value-compared-to-a-threshold often won't resolve as a discrete dimension. Swapping " +
          'RANK for INDEX() does NOT fix it — same order-of-operations dead-end for parameter-driven top/bottom-N membership.',
        xpath: '//calculation/@formula',
        suggestion:
          'Use the LOD membership tier calc pattern: (1) per-member value calc via FIXED LOD, (2) global percentile ' +
          'threshold calcs (e.g. { FIXED : PERCENTILE([Member Value], 0.80) }), (3) tier label calc comparing against ' +
          'thresholds (IF [Member Value] >= [Top Threshold] THEN "Top" ELSEIF … "Bottom" ELSE "Everyone Else" END). ' +
          'Put the tier calc on Rows (NOT the raw dimension) to roll the middle into one bar. ' +
          'See expertise://tableau/tactics/data/lod-membership-tier-calc. (Sets do NOT survive MCP apply — use LOD calcs.) ' +
          'RANK stays correct for a DISPLAYED ordinal value (a rank number on the viz, a Pareto, a bump chart).',
      });
    }

    return issues;
  },
};
