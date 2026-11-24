import { z } from 'zod';

import { CalculationLiteralType, prepFunctionByName } from './prepCalculationFunctions.js';

export const MAX_PREP_CALCULATION_LENGTH = 32 * 1024;
export const MAX_PREP_CALCULATION_DIAGNOSTICS = 20;
const MAX_NESTING = 64;

const positionSchema = z.object({
  line: z.number().int().min(0),
  character: z.number().int().min(0),
});
export const prepCalculationDiagnosticSchema = z.object({
  range: z.object({ start: positionSchema, end: positionSchema }),
  severity: z.literal(1),
  source: z.literal('tableau-prep'),
  code: z.enum([
    'PREP_CALC_SYNTAX',
    'PREP_CALC_FUNCTION',
    'PREP_CALC_ARITY',
    'PREP_CALC_TYPE',
    'PREP_CALC_ORDER',
    'PREP_CALC_LIMIT',
  ]),
  message: z.string().max(256),
});
export type PrepCalculationDiagnostic = z.infer<typeof prepCalculationDiagnosticSchema>;

type Span = { start: number; end: number };
type Issue = Span & Pick<PrepCalculationDiagnostic, 'code' | 'message'>;
type Token = Span & {
  kind: 'word' | 'field' | 'number' | 'string' | 'date' | 'symbol' | 'eof';
  text: string;
};
type Value = Span & { literalType?: CalculationLiteralType };

class CalculationError extends Error {
  constructor(readonly issue: Issue) {
    super(issue.message);
  }
}

function syntax(span: Span, message: string): never {
  throw new CalculationError({ ...span, code: 'PREP_CALC_SYNTAX', message });
}

function delimitedEnd(
  source: string,
  start: number,
  delimiter: string,
  escapeByDoubling: boolean,
): number {
  let cursor = start + 1;
  while (cursor < source.length) {
    const end = source.indexOf(delimiter, cursor);
    if (end < 0) break;
    if (!escapeByDoubling || source[end + 1] !== delimiter) return end + 1;
    cursor = end + 2;
  }
  return syntax({ start, end: source.length }, 'Close the field reference or literal.');
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const number = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
  const word = /[\p{L}_][\p{L}\p{M}\p{N}_]*/uy;
  for (let index = 0; index < source.length; ) {
    const start = index;
    const character = source[index];
    if (/\s/u.test(character)) {
      index++;
      continue;
    }
    if (source.startsWith('//', index)) {
      index += 2;
      while (index < source.length && !'\r\n'.includes(source[index])) index++;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) syntax({ start, end: source.length }, 'Close the block comment with */.');
      index = end + 2;
      continue;
    }
    if (character === '[' || character === "'" || character === '"' || character === '#') {
      const kind = character === '[' ? 'field' : character === '#' ? 'date' : 'string';
      index = delimitedEnd(source, start, character === '[' ? ']' : character, character !== '#');
      if (kind !== 'string' && !source.slice(start + 1, index - 1).trim())
        syntax({ start, end: index }, 'Enter a field name or a date inside the delimiters.');
      tokens.push({ kind, text: '', start, end: index });
      continue;
    }
    number.lastIndex = word.lastIndex = index;
    const numeric = number.exec(source)?.[0];
    const identifier = numeric === undefined ? word.exec(source)?.[0] : undefined;
    if (numeric !== undefined || identifier !== undefined) {
      const text = numeric ?? identifier!;
      index += text.length;
      tokens.push({ kind: numeric !== undefined ? 'number' : 'word', text, start, end: index });
      continue;
    }
    const pair = source.slice(index, index + 2);
    if (['<=', '>=', '<>', '!=', '=='].includes(pair)) index += 2;
    else if ('()+-*/%^=<>.,{}:'.includes(character)) index++;
    else syntax({ start, end: start + 1 }, 'Unexpected character in calculation.');
    tokens.push({ kind: 'symbol', text: source.slice(start, index), start, end: index });
  }
  tokens.push({ kind: 'eof', text: '', start: source.length, end: source.length });
  return tokens;
}

const precedence = new Map<string, number>([
  ['OR', 1],
  ['AND', 2],
  ['=', 3],
  ['==', 3],
  ['<>', 3],
  ['!=', 3],
  ['<', 3],
  ['<=', 3],
  ['>', 3],
  ['>=', 3],
  ['IN', 3],
  ['+', 4],
  ['-', 4],
  ['*', 5],
  ['/', 5],
  ['%', 5],
  ['^', 6],
]);
const reserved = new Set([
  'AND',
  'OR',
  'IN',
  'THEN',
  'ELSEIF',
  'ELSE',
  'WHEN',
  'END',
  'ASC',
  'DESC',
  'FIXED',
  'PARTITION',
  'ORDERBY',
  'INCLUDE',
  'EXCLUDE',
]);

class Parser {
  private index = 0;
  private orderByDepth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly issues: Issue[],
  ) {}

  parse(): void {
    this.expression(0, 0);
    if (this.peek().kind !== 'eof')
      syntax(this.peek(), 'Expected an operator or the end of the calculation.');
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private take(text: string): Token | undefined {
    if (this.peek().text.toUpperCase() === text) return this.tokens[this.index++];
    return undefined;
  }

  private expect(text: string): Token {
    return this.take(text) ?? syntax(this.peek(), `Expected ${text}.`);
  }

  private expression(min: number, depth: number): Value {
    if (depth > MAX_NESTING) {
      throw new CalculationError({
        ...this.peek(),
        code: 'PREP_CALC_LIMIT',
        message: 'Calculation nesting exceeds the validation limit.',
      });
    }
    let result = this.primary(depth);
    for (;;) {
      const operator = this.peek().text.toUpperCase();
      const rank = precedence.get(operator);
      if (rank === undefined || rank < min) return result;
      this.index++;
      if (operator === 'IN' && this.take('(')) {
        do {
          this.expression(0, depth + 1);
        } while (this.take(','));
        result = { start: result.start, end: this.expect(')').end };
      } else {
        const right = this.expression(operator === '^' ? rank : rank + 1, depth + 1);
        result = { start: result.start, end: right.end };
      }
    }
  }

  private primary(depth: number): Value {
    const token = this.peek();
    if (token.kind === 'eof') return syntax(token, 'Expected a calculation expression.');
    this.index++;
    const word = token.text.toUpperCase();
    const next = depth + 1;
    if (word === '+' || word === '-' || word === 'NOT') {
      const value = this.expression(word === 'NOT' ? 3 : 6, next);
      return {
        start: token.start,
        end: value.end,
        literalType:
          word === 'NOT' ? undefined : value.literalType === 'number' ? 'number' : undefined,
      };
    }
    if (word === '(') {
      const value = this.expression(0, next);
      return { ...value, start: token.start, end: this.expect(')').end };
    }
    if (word === '{') return this.clause(token, next);
    if (word === 'IF' || word === 'CASE') return this.conditional(token, word, next);
    if (token.kind === 'number' || token.kind === 'string' || token.kind === 'date')
      return { ...token, literalType: token.kind };
    if (word === 'TRUE' || word === 'FALSE') return { ...token, literalType: 'boolean' };
    if (word === 'NULL') return token;
    if (token.kind === 'word' && !reserved.has(word) && this.take('('))
      return this.call(token, next);
    if (token.kind !== 'field' && (token.kind !== 'word' || reserved.has(word)))
      return syntax(token, 'Expected a literal, field, function call, or calculation expression.');
    let last = token;
    while (this.take('.')) {
      last = this.peek();
      if (last.kind !== 'word' && last.kind !== 'field')
        syntax(last, 'Expected a field name after the dot.');
      this.index++;
    }
    return { start: token.start, end: last.end };
  }

  private conditional(token: Token, kind: 'IF' | 'CASE', depth: number): Value {
    if (kind === 'CASE') {
      this.expression(0, depth);
      this.expect('WHEN');
    }
    do {
      this.expression(0, depth);
      this.expect('THEN');
      this.expression(0, depth);
    } while (this.take(kind === 'CASE' ? 'WHEN' : 'ELSEIF'));
    if (this.take('ELSE')) this.expression(0, depth);
    return { start: token.start, end: this.expect('END').end };
  }

  private clause(token: Token, depth: number): Value {
    const keyword = this.peek().text.toUpperCase();
    if (!['FIXED', 'PARTITION', 'ORDERBY'].includes(keyword))
      return syntax(this.peek(), 'Expected FIXED, PARTITION, or ORDERBY inside the braces.');
    this.index++;
    if (keyword !== 'FIXED' || this.peek().text !== ':') {
      do {
        this.expression(0, depth);
        if (keyword === 'ORDERBY' && !this.take('ASC')) this.take('DESC');
      } while (this.take(','));
    }
    this.expect(':');
    if (
      keyword === 'PARTITION' &&
      (this.peek().text !== '{' || this.tokens[this.index + 1]?.text.toUpperCase() !== 'ORDERBY')
    )
      syntax(this.peek(), 'A PARTITION clause requires an ORDERBY clause after the colon.');
    if (keyword === 'ORDERBY') this.orderByDepth++;
    this.expression(0, depth);
    if (keyword === 'ORDERBY') this.orderByDepth--;
    return { start: token.start, end: this.expect('}').end };
  }

  private call(token: Token, depth: number): Value {
    const args: Value[] = [];
    if (this.peek().text !== ')') {
      do {
        args.push(this.expression(0, depth));
      } while (this.take(','));
    }
    const close = this.expect(')');
    const fn = prepFunctionByName.get(token.text.toUpperCase());
    if (!fn) {
      this.issue(
        token,
        'PREP_CALC_FUNCTION',
        `Function ${token.text.slice(0, 80)} is absent from the Tableau Prep 2026.3 function catalog.`,
      );
    } else if (args.length < fn.minArgs || args.length > fn.maxArgs) {
      const required =
        fn.minArgs === fn.maxArgs ? String(fn.minArgs) : `${fn.minArgs} to ${fn.maxArgs}`;
      this.issue(
        token,
        'PREP_CALC_ARITY',
        `${fn.name} expects ${required} argument(s). Received ${args.length}.`,
      );
    } else {
      if (fn.category === 'Analytic' && this.orderByDepth === 0)
        this.issue(
          token,
          'PREP_CALC_ORDER',
          `${fn.name} requires an ORDERBY clause in Tableau Prep.`,
        );
      args.forEach((value, index) => {
        const type = fn.parameters[index].literalType;
        if (type && value.literalType && value.literalType !== type)
          this.issue(
            value,
            'PREP_CALC_TYPE',
            `${fn.name} argument ${index + 1} expects ${type}. Received a ${value.literalType} literal.`,
          );
      });
    }
    return { start: token.start, end: close.end };
  }

  private issue(span: Span, code: Issue['code'], message: string): void {
    if (this.issues.length < MAX_PREP_CALCULATION_DIAGNOSTICS)
      this.issues.push({ ...span, code, message });
  }
}

export function validatePrepCalculation(expression: string): PrepCalculationDiagnostic[] {
  const issues: Issue[] = [];
  try {
    if (expression.length > MAX_PREP_CALCULATION_LENGTH)
      throw new CalculationError({
        start: 0,
        end: 0,
        code: 'PREP_CALC_LIMIT',
        message: 'Calculation exceeds the validation size limit.',
      });
    new Parser(tokenize(expression), issues).parse();
  } catch (error) {
    if (!(error instanceof CalculationError)) throw error;
    issues.push(error.issue);
  }
  if (!issues.length) return [];

  const lines = [0];
  // The offsets used by JavaScript strings and LSP UTF-16 positions have the same units.
  if (expression.length <= MAX_PREP_CALCULATION_LENGTH)
    for (const line of expression.matchAll(/\r\n|\r|\n/g)) lines.push(line.index + line[0].length);
  const position = (offset: number): { line: number; character: number } => {
    let line = 0;
    let high = lines.length;
    while (line + 1 < high) {
      const middle = (line + high) >>> 1;
      if (lines[middle] <= offset) line = middle;
      else high = middle;
    }
    return { line, character: offset - lines[line] };
  };
  return issues
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_PREP_CALCULATION_DIAGNOSTICS)
    .map((issue) => ({
      range: { start: position(issue.start), end: position(issue.end) },
      severity: 1,
      source: 'tableau-prep',
      code: issue.code,
      message: issue.message,
    }));
}
