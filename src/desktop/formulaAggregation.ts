const AGGREGATE_FUNCTIONS: ReadonlySet<string> = new Set([
  'SUM',
  'AVG',
  'COUNT',
  'COUNTD',
  'MEDIAN',
  'STDEV',
  'STDEVP',
  'VAR',
  'VARP',
  'ATTR',
  'CORR',
  'COVAR',
  'COVARP',
  'PERCENTILE',
  'COLLECT',
  'RAWSQLAGG_BOOL',
  'RAWSQLAGG_DATE',
  'RAWSQLAGG_DATETIME',
  'RAWSQLAGG_INT',
  'RAWSQLAGG_REAL',
  'RAWSQLAGG_STR',
]);

const TABLE_CALC_FUNCTIONS: ReadonlySet<string> = new Set([
  'INDEX',
  'SIZE',
  'FIRST',
  'LAST',
  'RANK',
  'RANK_DENSE',
  'RANK_MODIFIED',
  'RANK_PERCENTILE',
  'RANK_UNIQUE',
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
  'WINDOW_VAR',
  'WINDOW_VARP',
  'WINDOW_PERCENTILE',
  'WINDOW_CORR',
  'WINDOW_COVAR',
]);

function maskFormulaLiterals(formula: string): string {
  const chars = [...formula];
  let quote: "'" | '"' | undefined;
  let inBracketIdentifier = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const next = chars[index + 1];

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
      } else {
        chars[index] = ' ';
      }
      continue;
    }

    if (inBlockComment) {
      chars[index] = ' ';
      if (char === '*' && next === '/') {
        chars[index + 1] = ' ';
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (quote) {
      chars[index] = ' ';
      if (char === '\\' && next !== undefined) {
        chars[index + 1] = ' ';
        index += 1;
      } else if (char === quote && next === quote) {
        chars[index + 1] = ' ';
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (inBracketIdentifier) {
      chars[index] = ' ';
      if (char === ']' && next === ']') {
        chars[index + 1] = ' ';
        index += 1;
      } else if (char === ']') {
        inBracketIdentifier = false;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 1;
      inLineComment = true;
    } else if (char === '/' && next === '*') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 1;
      inBlockComment = true;
    } else if (char === "'" || char === '"') {
      chars[index] = '0';
      quote = char;
    } else if (char === '[') {
      chars[index] = '0';
      inBracketIdentifier = true;
    }
  }

  return chars.join('');
}

function topLevelArgumentCount(formula: string, openParenIndex: number): number | undefined {
  let parenthesisDepth = 1;
  let braceDepth = 0;
  let argumentCount = 0;
  let hasArgumentContent = false;

  for (let index = openParenIndex + 1; index < formula.length; index += 1) {
    const char = formula[index];

    if (char === '{') {
      braceDepth += 1;
      hasArgumentContent = true;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      hasArgumentContent = true;
    } else if (char === '(') {
      parenthesisDepth += 1;
      hasArgumentContent = true;
    } else if (char === ')') {
      if (parenthesisDepth === 1) {
        return hasArgumentContent ? argumentCount + 1 : argumentCount;
      }
      parenthesisDepth -= 1;
      hasArgumentContent = true;
    } else if (char === ',' && parenthesisDepth === 1 && braceDepth === 0) {
      argumentCount += 1;
      hasArgumentContent = false;
    } else if (!/\s/.test(char)) {
      hasArgumentContent = true;
    }
  }

  return undefined;
}

function isTableCalculation(functionName: string): boolean {
  return (
    TABLE_CALC_FUNCTIONS.has(functionName) ||
    functionName.startsWith('WINDOW_') ||
    functionName.startsWith('RUNNING_') ||
    functionName.startsWith('TOTAL_')
  );
}

/** Whether Tableau must bind a calculated field through a usr:/User column-instance. */
export function formulaRequiresUserDerivation(formula: string): boolean {
  const code = maskFormulaLiterals(String(formula ?? ''));
  let braceDepth = 0;

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (char === '{') {
      braceDepth += 1;
      continue;
    }
    if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (braceDepth > 0 || !/[A-Za-z_]/.test(char)) continue;

    const start = index;
    while (index + 1 < code.length && /[A-Za-z0-9_]/.test(code[index + 1])) {
      index += 1;
    }
    const functionName = code.slice(start, index + 1).toUpperCase();
    let openParenIndex = index + 1;
    while (openParenIndex < code.length && /\s/.test(code[openParenIndex])) {
      openParenIndex += 1;
    }
    if (code[openParenIndex] !== '(') continue;

    if (isTableCalculation(functionName) || AGGREGATE_FUNCTIONS.has(functionName)) {
      return true;
    }
    if (
      (functionName === 'MIN' || functionName === 'MAX') &&
      topLevelArgumentCount(code, openParenIndex) === 1
    ) {
      return true;
    }
  }

  return false;
}
