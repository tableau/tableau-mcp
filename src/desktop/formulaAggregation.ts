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

function isQualifiedReferenceSeparator(separator: string): boolean {
  let sawDot = false;

  for (let index = 0; index < separator.length; index += 1) {
    const char = separator[index];
    const next = separator[index + 1];
    if (/\s/.test(char)) continue;
    if (char === '/' && next === '/') {
      index += 2;
      while (index < separator.length && separator[index] !== '\n' && separator[index] !== '\r') {
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (
        index < separator.length &&
        !(separator[index] === '*' && separator[index + 1] === '/')
      ) {
        index += 1;
      }
      if (index < separator.length) index += 1;
      continue;
    }
    if (char === '.' && !sawDot) {
      sawDot = true;
      continue;
    }
    return false;
  }

  return sawDot;
}

function scanUnqualifiedCalculationReferences(
  formula: string,
): Array<{ value: string; start: number; end: number; lodDepth: number }> {
  const references: Array<{ value: string; start: number; end: number; lodDepth: number }> = [];
  let quote: "'" | '"' | undefined;
  let inLineComment = false;
  let inBlockComment = false;
  let braceDepth = 0;

  for (let index = 0; index < formula.length; index += 1) {
    const char = formula[index];
    const next = formula[index + 1];

    if (inLineComment) {
      if (char === '\n' || char === '\r') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (quote) {
      if (char === '\\' && next !== undefined) {
        index += 1;
      } else if (char === quote && next === quote) {
        index += 1;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      index += 1;
      inLineComment = true;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 1;
      inBlockComment = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '[') {
      const start = index;
      let end: number | undefined;
      for (index += 1; index < formula.length; index += 1) {
        if (formula[index] !== ']') continue;
        if (formula[index + 1] === ']') {
          index += 1;
          continue;
        }
        end = index + 1;
        break;
      }
      if (end !== undefined) {
        references.push({ value: formula.slice(start, end), start, end, lodDepth: braceDepth });
      }
      continue;
    }
    if (char === '{') {
      braceDepth += 1;
      continue;
    }
    if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
  }

  const qualified = new Set<number>();
  for (let index = 1; index < references.length; index += 1) {
    const between = formula.slice(references[index - 1].end, references[index].start);
    if (isQualifiedReferenceSeparator(between)) {
      qualified.add(index - 1);
      qualified.add(index);
    }
  }

  return references.filter((_reference, index) => !qualified.has(index));
}

function getUnqualifiedCalculationReferences(formula: string): string[] {
  return scanUnqualifiedCalculationReferences(formula)
    .filter((reference) => reference.lodDepth === 0)
    .map((reference) => reference.value);
}

/** @internal Dependency declarations include LOD inputs even though aggregation inference does not. */
export function getCalculationDependencyReferences(formula: string): string[] {
  return scanUnqualifiedCalculationReferences(formula).map((reference) => reference.value);
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

/** Resolve aggregate semantics through datasource-local calculated-field dependencies. */
export function createCalculationAggregationResolver(
  formulas: ReadonlyMap<string, string>,
): (columnName: string) => boolean {
  const aggregateFields = new Set<string>();
  const dependents = new Map<string, Set<string>>();

  for (const [columnName, formula] of formulas) {
    if (formulaRequiresUserDerivation(formula)) {
      aggregateFields.add(columnName);
    }
    for (const reference of getUnqualifiedCalculationReferences(formula)) {
      if (!formulas.has(reference)) continue;
      const referenceDependents = dependents.get(reference) ?? new Set<string>();
      referenceDependents.add(columnName);
      dependents.set(reference, referenceDependents);
    }
  }

  const queue = [...aggregateFields];
  for (let index = 0; index < queue.length; index += 1) {
    for (const dependent of dependents.get(queue[index]) ?? []) {
      if (aggregateFields.has(dependent)) continue;
      aggregateFields.add(dependent);
      queue.push(dependent);
    }
  }

  return (columnName: string) => aggregateFields.has(columnName);
}
