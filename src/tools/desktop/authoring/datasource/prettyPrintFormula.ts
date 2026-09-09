/**
 * Structural pretty-printer + XML-attribute encoder for a Tableau calculation
 * formula (the calc-language expression stored in a .twb as
 * `<calculation class='tableau' formula='...'/>`).
 *
 * There is no reusable formula formatter in the monolith to port -- only an
 * AST-based unparser that would require the full recursive-descent calc parser.
 * Instead this works on a token stream: it re-flows an existing formula onto
 * multiple lines with 2-space indentation, breaking each group (`(...)`,
 * `{...}`, `IF...END`, `CASE...END`) only when it does not fit in the width
 * budget, and soft-wrapping long flat runs at token boundaries.
 *
 * Two invariants make this safe on any input:
 *  - A break only ever replaces whitespace BETWEEN whole tokens, so a
 *    `[field ref]`, string literal, comment, or operator is never split.
 *  - Author token spacing is preserved (whitespace runs collapse to one space);
 *    the formatter adds line structure, it does not re-space operators.
 */

const WIDTH = 60;
const INDENT = '  ';

type TokenType =
  | 'ident'
  | 'field'
  | 'string'
  | 'number'
  | 'lparen'
  | 'rparen'
  | 'lbrace'
  | 'rbrace'
  | 'comma'
  | 'colon'
  | 'op'
  | 'lineComment'
  | 'blockComment';

export interface FormulaToken {
  type: TokenType;
  text: string;
  /** Whether whitespace separated this token from the previous one in the source. */
  spaceBefore: boolean;
}

const CONDITIONAL_OPENERS = new Set(['IF', 'CASE']);
const TWO_CHAR_OPS = new Set(['==', '!=', '<>', '<=', '>=']);
const OP_START = new Set(['+', '-', '*', '/', '%', '^', '=', '!', '<', '>', '|', '&']);

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function isIdentStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

/**
 * Split a formula into atomic tokens, discarding whitespace but recording where
 * it occurred. Strings, `[field refs]`, and comments are captured whole (with
 * their doubled-delimiter and escape rules) so later layout can never break
 * inside one. Exported for tests.
 */
function tokenize(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;
  let spaceBefore = false;

  const push = (type: TokenType, text: string): void => {
    tokens.push({ type, text, spaceBefore });
    spaceBefore = false;
  };

  while (index < formula.length) {
    const char = formula[index];
    const next = formula[index + 1];

    if (isWhitespace(char)) {
      spaceBefore = true;
      index += 1;
      continue;
    }

    if (char === '[') {
      let end = index + 1;
      while (end < formula.length) {
        if (formula[end] === ']') {
          if (formula[end + 1] === ']') {
            end += 2; // ']]' is an escaped literal ']'
            continue;
          }
          end += 1; // closing bracket
          break;
        }
        end += 1;
      }
      push('field', formula.slice(index, end));
      index = end;
      continue;
    }

    if (char === "'" || char === '"') {
      let end = index + 1;
      while (end < formula.length) {
        if (formula[end] === char) {
          if (formula[end + 1] === char) {
            end += 2; // doubled delimiter stays inside the literal
            continue;
          }
          end += 1;
          break;
        }
        if (formula[end] === '\\') {
          end += 2; // backslash escape
          continue;
        }
        end += 1;
      }
      push('string', formula.slice(index, end));
      index = end;
      continue;
    }

    if (char === '/' && next === '/') {
      let end = index + 2;
      while (end < formula.length && formula[end] !== '\n' && formula[end] !== '\r') {
        end += 1;
      }
      push('lineComment', formula.slice(index, end));
      index = end;
      continue;
    }

    if (char === '/' && next === '*') {
      const close = formula.indexOf('*/', index + 2);
      const end = close === -1 ? formula.length : close + 2;
      push('blockComment', formula.slice(index, end));
      index = end;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(next ?? ''))) {
      let end = index;
      while (end < formula.length && /[0-9.]/.test(formula[end])) {
        end += 1;
      }
      push('number', formula.slice(index, end));
      index = end;
      continue;
    }

    if (char === '(') {
      push('lparen', char);
      index += 1;
      continue;
    }
    if (char === ')') {
      push('rparen', char);
      index += 1;
      continue;
    }
    if (char === '{') {
      push('lbrace', char);
      index += 1;
      continue;
    }
    if (char === '}') {
      push('rbrace', char);
      index += 1;
      continue;
    }
    if (char === ',') {
      push('comma', char);
      index += 1;
      continue;
    }
    if (char === ':') {
      push('colon', char);
      index += 1;
      continue;
    }

    if (OP_START.has(char)) {
      const two = char + (next ?? '');
      if (TWO_CHAR_OPS.has(two)) {
        push('op', two);
        index += 2;
      } else {
        push('op', char);
        index += 1;
      }
      continue;
    }

    if (isIdentStart(char)) {
      let end = index + 1;
      while (end < formula.length && isIdentPart(formula[end])) {
        end += 1;
      }
      push('ident', formula.slice(index, end));
      index = end;
      continue;
    }

    // Unknown single character: keep it as an opaque operator so nothing is dropped.
    push('op', char);
    index += 1;
  }

  return tokens;
}

function isKeyword(token: FormulaToken, keyword: string): boolean {
  return token.type === 'ident' && token.text.toUpperCase() === keyword;
}

function isConditionalOpener(token: FormulaToken): boolean {
  return token.type === 'ident' && CONDITIONAL_OPENERS.has(token.text.toUpperCase());
}

/** Index of the token that closes the group opened at `start`, or -1 if `start` is not an opener. */
function matchingClose(tokens: FormulaToken[], start: number): number {
  const opener = tokens[start];
  if (opener.type === 'lparen' || opener.type === 'lbrace') {
    const openType = opener.type;
    const closeType = openType === 'lparen' ? 'rparen' : 'rbrace';
    let depth = 0;
    for (let index = start; index < tokens.length; index += 1) {
      if (tokens[index].type === openType) depth += 1;
      else if (tokens[index].type === closeType) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }
  if (isConditionalOpener(opener)) {
    let depth = 0;
    for (let index = start; index < tokens.length; index += 1) {
      if (isConditionalOpener(tokens[index])) depth += 1;
      else if (isKeyword(tokens[index], 'END')) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }
  return -1;
}

/** Render tokens [start, end] inclusive on a single line, preserving author spacing. */
function flatText(tokens: FormulaToken[], start: number, end: number): string {
  let text = '';
  for (let index = start; index <= end; index += 1) {
    if (index > start && tokens[index].spaceBefore) text += ' ';
    text += tokens[index].text;
  }
  return text;
}

function containsLineComment(tokens: FormulaToken[], start: number, end: number): boolean {
  for (let index = start; index <= end; index += 1) {
    if (tokens[index].type === 'lineComment') return true;
  }
  return false;
}

function indentOf(level: number): string {
  return INDENT.repeat(level);
}

/** A token that must not begin a soft-wrapped line. */
function mustHug(token: FormulaToken): boolean {
  return (
    token.type === 'rparen' ||
    token.type === 'rbrace' ||
    token.type === 'comma' ||
    token.type === 'colon'
  );
}

interface Rendered {
  text: string;
  endColumn: number;
}

/** Split the inner tokens [start, end) of a paren/brace group on top-level commas. */
function splitTopLevelCommas(
  tokens: FormulaToken[],
  start: number,
  end: number,
): Array<{ start: number; end: number }> {
  const segments: Array<{ start: number; end: number }> = [];
  let segmentStart = start;
  let parens = 0;
  let braces = 0;
  let conditionals = 0;

  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token.type === 'lparen') parens += 1;
    else if (token.type === 'rparen') parens -= 1;
    else if (token.type === 'lbrace') braces += 1;
    else if (token.type === 'rbrace') braces -= 1;
    else if (isConditionalOpener(token)) conditionals += 1;
    else if (isKeyword(token, 'END')) conditionals -= 1;
    else if (token.type === 'comma' && parens === 0 && braces === 0 && conditionals === 0) {
      segments.push({ start: segmentStart, end: index });
      segmentStart = index + 1;
    }
  }
  segments.push({ start: segmentStart, end });
  return segments;
}

/** Split a conditional [start..close] (close = its END) into keyword-led clauses. */
function splitConditionalClauses(
  tokens: FormulaToken[],
  start: number,
  close: number,
): Array<{ start: number; end: number }> {
  const boundaries = isKeyword(tokens[start], 'IF')
    ? new Set(['THEN', 'ELSEIF', 'ELSE'])
    : new Set(['WHEN', 'ELSE']);
  const clauses: Array<{ start: number; end: number }> = [];
  let clauseStart = start;
  let conditionals = 0;
  let parens = 0;
  let braces = 0;

  for (let index = start; index < close; index += 1) {
    const token = tokens[index];
    if (isConditionalOpener(token)) {
      conditionals += 1;
    } else if (isKeyword(token, 'END')) {
      conditionals -= 1;
    } else if (token.type === 'lparen') {
      parens += 1;
    } else if (token.type === 'rparen') {
      parens -= 1;
    } else if (token.type === 'lbrace') {
      braces += 1;
    } else if (token.type === 'rbrace') {
      braces -= 1;
    } else if (
      conditionals === 1 &&
      parens === 0 &&
      braces === 0 &&
      token.type === 'ident' &&
      boundaries.has(token.text.toUpperCase())
    ) {
      clauses.push({ start: clauseStart, end: index });
      clauseStart = index;
    }
  }
  clauses.push({ start: clauseStart, end: close });
  return clauses;
}

function renderBrokenGroup(
  tokens: FormulaToken[],
  start: number,
  close: number,
  level: number,
): Rendered {
  const opener = tokens[start];

  if (isConditionalOpener(opener)) {
    const clauses = splitConditionalClauses(tokens, start, close);
    let text = '';
    clauses.forEach((clause, position) => {
      if (position === 0) {
        text += render(tokens, clause.start, clause.end, level, level * INDENT.length).text;
      } else {
        text += '\n' + indentOf(level);
        text += render(tokens, clause.start, clause.end, level, level * INDENT.length).text;
      }
    });
    text += '\n' + indentOf(level) + 'END';
    return { text, endColumn: level * INDENT.length + 3 };
  }

  // Parenthesised / brace group: opener, one indented line per argument, closer.
  const closer = opener.type === 'lbrace' ? '}' : ')';
  const segments = splitTopLevelCommas(tokens, start + 1, close);
  let text = opener.text;
  segments.forEach((segment, position) => {
    text += '\n' + indentOf(level + 1);
    text += render(tokens, segment.start, segment.end, level + 1, (level + 1) * INDENT.length).text;
    if (position < segments.length - 1) text += ',';
  });
  text += '\n' + indentOf(level) + closer;
  return { text, endColumn: level * INDENT.length + 1 };
}

/** Lay out tokens [start, end) starting at `startColumn` under indentation `level`. */
function render(
  tokens: FormulaToken[],
  start: number,
  end: number,
  level: number,
  startColumn: number,
): Rendered {
  let text = '';
  let column = startColumn;
  let suppressSpace = false;
  let index = start;

  while (index < end) {
    const token = tokens[index];
    const isFirst = index === start;
    const spaceBefore = token.spaceBefore && !isFirst && !suppressSpace;
    suppressSpace = false;

    const close = matchingClose(tokens, index);
    if (close !== -1 && close < end) {
      const flat = flatText(tokens, index, close);
      const cost = spaceBefore ? 1 : 0;
      const hasComment = containsLineComment(tokens, index, close);
      const continuation = (level + 1) * INDENT.length;
      // A conditional (IF/CASE) embedded in a larger expression is force-broken so
      // its THEN/ELSE clauses land on their own lines even when the IF alone fits
      // the width budget -- an inline IF next to more code makes the combined line
      // hard to read, and the calc editor renders the vertical form cleanly.
      const forceBreak =
        isConditionalOpener(tokens[index]) && !(index === start && close === end - 1);
      if (!forceBreak && !hasComment && column + cost + flat.length <= WIDTH) {
        if (spaceBefore) {
          text += ' ';
          column += 1;
        }
        text += flat;
        column += flat.length;
      } else if (
        !forceBreak &&
        !hasComment &&
        spaceBefore &&
        continuation + flat.length <= WIDTH
      ) {
        // Prefer moving the whole group to a fresh continuation line over splitting
        // it -- keeps calls like DATEPART('dayofyear',[Order Date]) intact.
        text += '\n' + indentOf(level + 1);
        text += flat;
        column = continuation + flat.length;
      } else {
        if (spaceBefore) {
          text += ' ';
          column += 1;
        }
        const broken = renderBrokenGroup(tokens, index, close, level);
        text += broken.text;
        column = broken.endColumn;
        // A broken IF/CASE ends with END on its own line; if any code follows,
        // start it on a fresh line so operators consuming the result don't
        // trail after END and re-merge the block back into a wide line.
        if (isConditionalOpener(tokens[index]) && close + 1 < end) {
          text += '\n' + indentOf(level);
          column = level * INDENT.length;
          suppressSpace = true;
        }
      }
      index = close + 1;
      continue;
    }

    const tokenLength = token.text.length;
    const cost = spaceBefore ? 1 : 0;
    if (spaceBefore && column + cost + tokenLength > WIDTH && !mustHug(token)) {
      text += '\n' + indentOf(level + 1);
      text += token.text;
      column = (level + 1) * INDENT.length + tokenLength;
    } else {
      if (spaceBefore) {
        text += ' ';
        column += 1;
      }
      text += token.text;
      column += tokenLength;
    }

    // A `//` comment runs to end of line, so anything after it must start a new line.
    if (token.type === 'lineComment' && index + 1 < end) {
      text += '\n' + indentOf(level);
      column = level * INDENT.length;
      suppressSpace = true;
    }

    index += 1;
  }

  return { text, endColumn: column };
}

/**
 * Re-flow a calc formula onto multiple lines for readability, breaking groups
 * that exceed ~60 columns and indenting by 2 spaces per level. Returns readable
 * text with real `\n` line breaks (not yet XML-encoded). Whitespace-insensitive
 * semantics are preserved exactly; see the module header for the invariants.
 */
export function formatFormula(formula: string): string {
  const tokens = tokenize(formula);
  if (tokens.length === 0) return formula.trim();
  return render(tokens, 0, tokens.length, 0, 0).text;
}

/**
 * Encode formula text into the exact value for a single-quoted `formula`
 * attribute: escape the five XML specials, then emit each newline as the
 * character references `&#13;&#10;` (raw newlines are normalized to a space by
 * XML attribute-value parsing, so they would otherwise be lost -- and a raw
 * break after a `//` comment would let it swallow the rest of the expression).
 */
export function encodeFormulaAttribute(text: string): string {
  const escaped = text
    .replaceAll('&', '&amp;') // must run first, before the entities below introduce '&'
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&apos;')
    .replaceAll('"', '&quot;');
  return escaped.replace(/\r\n|\r|\n/g, '&#13;&#10;');
}

/** Inverse of {@link encodeFormulaAttribute}: decode a `formula` attribute value back to text. */
export function readFormula(attr: string): string {
  return attr
    .replace(/&#13;&#10;|&#13;|&#10;/g, '\n')
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * One-shot: pretty-print a formula and encode it for a `.twb` `formula`
 * attribute, so Tableau's calc editor renders it multi-line and indented.
 */
export function prettyPrintFormula(formula: string): string {
  return encodeFormulaAttribute(formatFormula(formula));
}

export { tokenize as tokenizeFormulaForTest };
