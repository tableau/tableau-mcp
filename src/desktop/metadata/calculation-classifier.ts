const AGG_FUNCS = [
  'SUM',
  'AVG',
  'COUNTD',
  'COUNT',
  'MEDIAN',
  'MIN',
  'MAX',
  'STDEVP',
  'STDEV',
  'VARP',
  'VAR',
  'ATTR',
  'CORR',
  'COVARP',
  'COVAR',
  'PERCENTILE',
];

const TABLE_CALC_FUNCS = [
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
  'TOTAL',
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

const AGG_RE = new RegExp(`\\b(${AGG_FUNCS.join('|')})\\s*\\(`, 'i');
const TABLE_CALC_RE = new RegExp(`\\b(${TABLE_CALC_FUNCS.join('|')})\\s*\\(`, 'i');

export function stripStringsAndComments(formula: string): string {
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
      if (c === '\\' && next) {
        out += '  ';
        i += 1;
        continue;
      }
      if (c === "'") inSingle = false;
      out += ' ';
      continue;
    }
    if (inDouble) {
      if (c === '\\' && next) {
        out += '  ';
        i += 1;
        continue;
      }
      if (c === '"') inDouble = false;
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

export function stripBracketedIdentifiers(formula: string): string {
  return formula.replace(/\[(?:[^\]]|\]\])*\]/g, (identifier) => ' '.repeat(identifier.length));
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

export function isAggregateOrTableCalc(formula: string): boolean {
  const sanitized = stripBracketedIdentifiers(stripStringsAndComments(formula));
  if (TABLE_CALC_RE.test(sanitized)) return true;
  return AGG_RE.test(stripLodBlocks(sanitized));
}
