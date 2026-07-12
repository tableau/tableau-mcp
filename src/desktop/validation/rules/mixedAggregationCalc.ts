import type { ValidationIssue, ValidationRule } from '../types.js';

const AGG_FUNC_NAMES = [
  'SUM',
  'AVG',
  'COUNT',
  'COUNTD',
  'MIN',
  'MAX',
  'MEDIAN',
  'PERCENTILE',
  'ATTR',
  'TOTAL',
  'INDEX',
  'SIZE',
  'FIRST',
  'LAST',
  'RANK_DENSE',
  'RANK_MODIFIED',
  'RANK_PERCENTILE',
  'RANK_UNIQUE',
  'RANK',
  'LOOKUP',
  'PREVIOUS_VALUE',
  'RUNNING_SUM',
  'RUNNING_AVG',
  'RUNNING_MIN',
  'RUNNING_MAX',
  'RUNNING_COUNT',
  'WINDOW_SUM',
  'WINDOW_AVG',
  'WINDOW_MIN',
  'WINDOW_MAX',
  'WINDOW_COUNT',
  'WINDOW_MEDIAN',
  'WINDOW_STDEV',
  'WINDOW_STDEVP',
  'WINDOW_VARP',
  'WINDOW_VAR',
  'WINDOW_PERCENTILE',
  'WINDOW_CORR',
  'WINDOW_COVAR',
];

const AGG_CALL_RE = new RegExp(`\\b(${AGG_FUNC_NAMES.join('|')})\\s*\\([^()]*\\)`, 'gi');

function isAggregateFunction(name: string): boolean {
  const upper = name.toUpperCase();
  if (AGG_FUNC_NAMES.includes(upper)) return true;
  if (upper.startsWith('WINDOW_') || upper.startsWith('RUNNING_')) return true;
  return upper === 'TOTAL' || upper.startsWith('TOTAL_');
}

function stripLodBlocks(formula: string): string {
  let prev: string;
  let out = formula;
  do {
    prev = out;
    out = out.replace(/\{[^{}]*\}/g, ' ');
  } while (out !== prev);
  return out;
}

function stripStringsAndComments(formula: string): string {
  const src = String(formula ?? '');
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const next = i + 1 < src.length ? src[i + 1] : '';

    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (c === "'" && src[i - 1] !== '\\') inSingle = false;
      out += ' ';
      continue;
    }
    if (inDouble) {
      if (c === '"' && src[i - 1] !== '\\') inDouble = false;
      out += ' ';
      continue;
    }

    if (c === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += ' ';
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += ' ';
      continue;
    }

    out += c;
  }

  return out;
}

function stripAggregateCalls(formula: string): string {
  let prev: string;
  let out = formula;
  do {
    prev = out;
    out = out.replace(AGG_CALL_RE, ' ');
  } while (out !== prev);
  return out;
}

function hasAggregateInExpression(expr: string): boolean {
  const upper = stripLodBlocks(expr).toUpperCase();
  const re = /\b([A-Z_][A-Z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(upper))) {
    if (isAggregateFunction(m[1])) return true;
  }
  return false;
}

function extractBareFieldsFromCondition(condition: string): string[] {
  const withoutLod = stripLodBlocks(condition);
  const withoutParams = withoutLod.replace(/\[Parameters\]\.\[[^\]]+\]/gi, ' ');
  const withoutAgg = stripAggregateCalls(withoutParams);
  const bare: string[] = [];
  const fieldRe = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(withoutAgg))) {
    const name = m[1]?.trim();
    if (!name || /^Parameters$/i.test(name)) continue;
    bare.push(name);
  }
  return bare;
}

interface ConditionalBlock {
  kind: 'IF' | 'CASE' | 'IIF';
  condition: string;
  branches: string;
}

function isWordAt(haystackUpper: string, index: number, word: string): boolean {
  const n = haystackUpper.length;
  if (index < 0 || index + word.length > n) return false;
  if (haystackUpper.slice(index, index + word.length) !== word) return false;
  const before = index === 0 ? '' : haystackUpper[index - 1];
  const after = index + word.length < n ? haystackUpper[index + word.length] : '';
  return !/[A-Z_]/.test(before) && !/[A-Z_]/.test(after);
}

function findIfBlocks(code: string): ConditionalBlock[] {
  const blocks: ConditionalBlock[] = [];
  const upper = code.toUpperCase();
  let i = 0;

  while (i < code.length) {
    if (!isWordAt(upper, i, 'IF')) {
      i += 1;
      continue;
    }

    let condStart = i + 2;
    while (condStart < code.length && /\s/.test(code[condStart])) condStart += 1;
    let depth = 1;
    let thenPos = -1;
    let j = condStart;

    while (j < code.length) {
      if (isWordAt(upper, j, 'IF')) {
        depth += 1;
        j += 2;
        continue;
      }
      if (isWordAt(upper, j, 'END')) {
        depth -= 1;
        const endTokenStart = j;
        j += 3;
        if (depth === 0) {
          if (thenPos !== -1) {
            const condition = code.slice(condStart, thenPos).trim();
            const branches = code.slice(thenPos + 4, endTokenStart).trim();
            if (condition && branches) blocks.push({ kind: 'IF', condition, branches });
          }
          break;
        }
        continue;
      }
      if (isWordAt(upper, j, 'THEN') && depth === 1 && thenPos === -1) {
        thenPos = j;
        j += 4;
        continue;
      }
      j += 1;
    }

    i = j;
  }

  return blocks;
}

function findCaseBlocks(code: string): ConditionalBlock[] {
  const blocks: ConditionalBlock[] = [];
  const upper = code.toUpperCase();
  let i = 0;

  while (i < code.length) {
    if (!isWordAt(upper, i, 'CASE')) {
      i += 1;
      continue;
    }

    let condStart = i + 4;
    while (condStart < code.length && /\s/.test(code[condStart])) condStart += 1;
    let depth = 1;
    let firstWhen = -1;
    let j = condStart;

    while (j < code.length) {
      if (isWordAt(upper, j, 'CASE')) {
        depth += 1;
        j += 4;
        continue;
      }
      if (isWordAt(upper, j, 'END')) {
        depth -= 1;
        const endTokenStart = j;
        j += 3;
        if (depth === 0) {
          if (firstWhen !== -1) {
            const condition = code.slice(condStart, firstWhen).trim();
            const branches = code.slice(firstWhen, endTokenStart).trim();
            if (condition && branches) blocks.push({ kind: 'CASE', condition, branches });
          }
          break;
        }
        continue;
      }
      if (depth === 1 && firstWhen === -1 && isWordAt(upper, j, 'WHEN')) {
        firstWhen = j;
        j += 4;
        continue;
      }
      j += 1;
    }

    i = j;
  }

  return blocks;
}

function splitTopLevelArgs(argList: string): string[] {
  const args: string[] = [];
  let current = '';
  let depthParen = 0;
  let depthBrace = 0;

  for (const c of argList) {
    if (c === '(') depthParen += 1;
    if (c === ')') depthParen -= 1;
    if (c === '{') depthBrace += 1;
    if (c === '}') depthBrace -= 1;

    if (c === ',' && depthParen === 0 && depthBrace === 0) {
      if (current.trim()) args.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function findIifBlocks(code: string): ConditionalBlock[] {
  const blocks: ConditionalBlock[] = [];
  const upper = code.toUpperCase();
  let i = 0;

  while (i < code.length) {
    if (!isWordAt(upper, i, 'IIF')) {
      i += 1;
      continue;
    }

    let j = i + 3;
    while (j < code.length && /\s/.test(code[j])) j += 1;
    if (code[j] !== '(') {
      i += 3;
      continue;
    }

    const parenStart = j;
    let depth = 1;
    j += 1;
    let parenEnd = -1;
    while (j < code.length) {
      const c = code[j];
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          parenEnd = j;
          break;
        }
      }
      j += 1;
    }
    if (parenEnd === -1) {
      i = j;
      continue;
    }

    const args = splitTopLevelArgs(code.slice(parenStart + 1, parenEnd));
    if (args.length >= 2) {
      const condition = args[0].trim();
      const branches = args.slice(1).join(', ').trim();
      if (condition && branches) blocks.push({ kind: 'IIF', condition, branches });
    }
    i = parenEnd + 1;
  }

  return blocks;
}

function hasMixedAggregationShape(formula: string): boolean {
  const raw = String(formula ?? '');
  if (!raw) return false;
  const sanitized = stripStringsAndComments(raw);
  if (!/\b(IF|CASE|IIF)\b/i.test(sanitized)) return false;

  const blocks = [...findIfBlocks(sanitized), ...findCaseBlocks(sanitized), ...findIifBlocks(sanitized)];

  for (const block of blocks) {
    if (extractBareFieldsFromCondition(block.condition).length === 0) continue;
    if (hasAggregateInExpression(block.branches)) return true;
  }

  return false;
}

export function checkFormula(formula: string): boolean {
  try {
    return hasMixedAggregationShape(formula);
  } catch {
    return false;
  }
}

export const mixedAggregationCalcRule: ValidationRule = {
  id: 'mixed-aggregation-calc',
  description:
    'Warns when a calc mixes a row-level IF/CASE/IIF condition (bare field comparison) with aggregate branches ' +
    '(SUM/AVG/COUNTD/WINDOW_*/RUNNING_*/TOTAL/etc.) — the pattern that produces a lazy red error on Desktop. ' +
    'Wrap the condition in an aggregate at the viz grain (e.g. MIN([Profit Tier]) = "Everyone Else") or remove aggregates from the branches.',
  contexts: ['workbook', 'worksheet'],

  validate(xml: string): ValidationIssue[] {
    const formulas = [...String(xml ?? '').matchAll(/formula=(['"])([\s\S]*?)\1/gi)].map((m) => m[2] ?? '');
    const issues: ValidationIssue[] = [];
    let fired = false;

    for (const formula of formulas) {
      if (!checkFormula(formula) || fired) continue;
      fired = true;
      issues.push({
        ruleId: 'mixed-aggregation-calc',
        severity: 'warning',
        message:
          'This calc mixes a row-level condition (bare field in IF/CASE/IIF) with aggregate branches ' +
          '(SUM/AVG/COUNTD/WINDOW_*/RUNNING_*/TOTAL/etc.). Tableau accepts the XML but flags the field red in the UI ' +
          'and the viz breaks with no signal to the agent.',
        xpath: '//calculation/@formula',
        suggestion:
          'Either aggregate the condition at the viz grain (for example: IF MIN([Profit Tier]) = "Everyone Else" THEN ...) ' +
          'or make all branches row-level (remove viz-level aggregates). See the Display Profit example in ' +
          'lod-membership-tier-calc for a proven fix.',
      });
    }

    return issues;
  },
};
