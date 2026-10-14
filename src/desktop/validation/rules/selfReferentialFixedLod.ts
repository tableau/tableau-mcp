import { decodeXmlEntities } from '../../xmlElement.js';
import type { ValidationIssue, ValidationRule } from '../types.js';

type Lod = { start: number; end: number; dims: string; body: string };

/** Every `{ FIXED dims : body }` in the formula, nested ones included (depth tracked by brace matching). */
function findFixedLods(formula: string, raw: string): Array<Lod & { depth: number }> {
  const lods: Array<Lod & { depth: number }> = [];
  const open: Array<{ start: number; fixed: boolean }> = [];
  for (let i = 0; i < formula.length; i++) {
    if (formula[i] === '{') {
      open.push({ start: i, fixed: /^\{\s*FIXED\b/i.test(formula.slice(i)) });
    } else if (formula[i] === '}') {
      const o = open.pop();
      if (!o?.fixed) continue;
      const inner = formula.slice(o.start + 1, i).replace(/^\s*FIXED\b/i, '');
      const colon = inner.indexOf(':');
      if (colon === -1) continue;
      const rawInner = raw.slice(o.start + 1, i).replace(/^\s*FIXED\b/i, '');
      const dims = (rawInner.slice(0, colon).match(/\[(?:[^\]]|\]\])*\]/g) ?? [])
        .map((d) => d.toLowerCase())
        .sort()
        .join(',');
      lods.push({
        start: o.start,
        end: i + 1,
        dims,
        body: inner.slice(colon + 1),
        depth: open.length,
      });
    }
  }
  return lods;
}

/**
 * One left-to-right pass over five token kinds: `[field]` names (`]]` is an escaped bracket), `"..."` and
 * `'...'` strings (doubled quotes), `//` line comments and block comments. The result keeps every index but
 * blanks string and comment text and field-name contents, so braces and operators match only in real code.
 */
function maskTokens(formula: string): string {
  const out = formula.split('');
  const blank = (from: number, to: number): void => {
    for (let j = from; j < to && j < out.length; j++) if (out[j] !== '\n') out[j] = ' ';
  };
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '[') {
      let k = i + 1;
      while (k < formula.length) {
        if (formula[k] === ']') {
          if (formula[k + 1] === ']') {
            k += 2;
            continue;
          }
          break;
        }
        k++;
      }
      blank(i + 1, k);
      i = k + 1;
    } else if (ch === '"' || ch === "'") {
      let k = i + 1;
      while (k < formula.length) {
        if (formula[k] === ch) {
          if (formula[k + 1] === ch) {
            k += 2;
            continue;
          }
          break;
        }
        k++;
      }
      blank(i, k + 1);
      i = k + 1;
    } else if (ch === '/' && formula[i + 1] === '/') {
      let k = i;
      while (k < formula.length && formula[k] !== '\n') k++;
      blank(i, k);
      i = k;
    } else if (ch === '/' && formula[i + 1] === '*') {
      const close = formula.indexOf('*/', i + 2);
      const k = close === -1 ? formula.length : close + 2;
      blank(i, k);
      i = k;
    } else {
      i++;
    }
  }
  return out.join('');
}

const RANKING_TELL = /\b(?:COUNTD|COUNT|RANK\w*|PERCENTILE|WINDOW_\w+|INDEX)\b/i;
const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** True when the position sits inside the parentheses of a ranking or counting call. */
function insideRankingCall(formula: string, at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (formula[i] === ')') depth++;
    else if (formula[i] === '(') {
      if (depth > 0) depth--;
      else if (
        RANKING_TELL.test(formula.slice(Math.max(0, i - 20), i).match(/[A-Za-z_]+\s*$/)?.[0] ?? '')
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A real self-reference: a FIXED nested over its own dimension list inside a ranking or counting call, or two
 * same-dimension FIXED LODs that are the direct operands of one comparison and are the same expression or sit
 * inside a ranking or counting call.
 */
function selfReference(raw: string): string | undefined {
  const formula = maskTokens(raw);
  const lods = findFixedLods(formula, raw);
  for (const outer of lods) {
    if (!outer.dims || !RANKING_TELL.test(outer.body)) continue;
    const inner = lods.find(
      (l) => l !== outer && l.start > outer.start && l.end < outer.end && l.dims === outer.dims,
    );
    if (inner) return 'nested';
  }
  for (const m of formula.matchAll(/<>|!=|>=|<=|==|=|>|</g)) {
    if (m[0] === '<>' || m[0] === '!=') continue;
    const at = m.index ?? 0;
    const left = lods.find((l) => l.end <= at && /^[\s)]*$/.test(formula.slice(l.end, at)));
    const right = lods.find(
      (l) =>
        l.start >= at + m[0].length && /^[\s(]*$/.test(formula.slice(at + m[0].length, l.start)),
    );
    if (!left || !right || !left.dims || left.dims !== right.dims) continue;
    const same =
      normalize(raw.slice(left.start, left.end)) === normalize(raw.slice(right.start, right.end));
    if (same || insideRankingCall(formula, at)) return 'compared';
  }
  return undefined;
}

export const selfReferentialFixedLodRule: ValidationRule = {
  id: 'self-referential-fixed-lod',
  description:
    'Warns when a FIXED LOD contains another FIXED LOD over the same non-empty dimension list and the outer LOD body ' +
    'has a COUNT, COUNTD, RANK*, PERCENTILE, WINDOW_* or INDEX call anywhere (it need not wrap the inner LOD; this ' +
    'includes count-of-rows-above-the-group-average shapes), or compares two ' +
    'same-dimension FIXED LODs that are direct operands of one comparison (> < >= <= = ==) and are either the same text ' +
    '(ignoring case and spacing) or sit inside such a ranking or counting call. Such a calc can evaluate to a per-member ' +
    'constant and not partition or re-rank. Use the LOD membership tier calc pattern (see lod-membership-tier-calc). ' +
    'String literals, comments and field names are not read as code. It is a heuristic over formula text, so it only warns.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const formulas = [...String(xml ?? '').matchAll(/formula=(['"])([\s\S]*?)\1/gi)].map((m) =>
      decodeXmlEntities(m[2] ?? ''),
    );
    const issues: ValidationIssue[] = [];

    for (const formula of formulas) {
      const kind = selfReference(formula);
      if (!kind) continue;
      const fixedCount = findFixedLods(maskTokens(formula), formula).length;
      const nested = kind === 'nested';

      issues.push({
        ruleId: 'self-referential-fixed-lod',
        severity: 'warning',
        message:
          'This calc may compute top/bottom-N membership by nesting or comparing FIXED LODs over the same dimension ' +
          `(${fixedCount} FIXED expression(s)${nested ? ', nested' : ''}). A FIXED LOD over a member evaluates to a ` +
          "per-member constant, so the comparison is constant — membership won't partition and won't re-rank when the " +
          'parameter or period changes. That is a known dead-end approach; if this calc is a per-member value rather than a membership test, you can ignore this warning.',
        xpath: '//calculation/@formula',
        suggestion:
          'For top/bottom-N membership, do not nest a FIXED LOD over the same dimension list, or compare two FIXED LODs over the same dimension list. ' +
          'Use the LOD membership tier calc pattern: a per-member value calc via FIXED LOD, compared against GLOBAL ' +
          'threshold LODs with no dimensions (e.g. { FIXED : PERCENTILE([Member Value], 0.80) }), then a tier label calc. ' +
          'See expertise://tableau/tactics/data/lod-membership-tier-calc. (Sets do NOT survive MCP apply — use LOD calcs.)',
      });
    }

    return issues;
  },
};
