import { createHash } from 'node:crypto';

import { PrepPhysicalType, PrepScriptAnalysis } from '../types/prepScript.js';

// Port of ghidra-prep d660ac7's bounded script_analysis contract. This is a
// literal/field-reference reader, never a Python/R runtime or expression evaluator.
export const MAX_PREP_SCRIPT_BYTES = 1024 * 1024;
const MAX_TOKENS = 40000;
type Token = { value: string; literal?: string; reference?: string; line: number; column: number };
type FunctionBody = { argument?: string; body: Token[] };
const types: Record<string, PrepPhysicalType> = {
  prep_string: 'string',
  prep_int: 'integer',
  prep_decimal: 'real',
  prep_bool: 'boolean',
  prep_date: 'date',
  prep_datetime: 'datetime',
};
const name = (value: string | undefined): value is string =>
  !!value &&
  value.trim().length > 0 &&
  value.length <= 1024 &&
  ![...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** Strings/comments are consumed before looking for identifiers or selectors. */
function pythonString(value: string): string | undefined {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\') {
      result += value[i];
      continue;
    }
    const next = value[++i];
    if (next === undefined) return;
    if (next === '\n') continue;
    const escapes: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      v: '\v',
      a: '\x07',
      '\\': '\\',
      '"': '"',
      "'": "'",
    };
    if (Object.hasOwn(escapes, next)) {
      result += escapes[next];
      continue;
    }
    const digits = next === 'x' ? 2 : next === 'u' ? 4 : next === 'U' ? 8 : 0;
    if (digits) {
      const hex = value.slice(i + 1, i + 1 + digits);
      if (hex.length !== digits || !/^[a-f0-9]+$/i.test(hex) || Number.parseInt(hex, 16) > 0x10ffff)
        return;
      result += String.fromCodePoint(Number.parseInt(hex, 16));
      i += digits;
    } else result += '\\' + next;
  }
  return name(result) ? result : undefined;
}

function tokens(text: string, language: 'python' | 'r'): Token[] {
  const result: Token[] = [];
  let i = 0,
    line = 0,
    column = 0;
  const push = (
    value: string,
    atLine: number,
    atColumn: number,
    literal?: string,
    reference?: string,
  ): void => {
    if (result.length >= MAX_TOKENS) throw new RangeError('SCRIPT_TOKEN_LIMIT');
    result.push({
      value,
      line: atLine,
      column: atColumn,
      ...(literal === undefined ? {} : { literal }),
      ...(reference === undefined ? {} : { reference }),
    });
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') {
      if (result.at(-1)?.value !== '\n') push('\n', line, column);
      i++;
      line++;
      column = 0;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      column++;
      continue;
    }
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') {
        i++;
        column++;
      }
      continue;
    }
    const atLine = line,
      atColumn = column;
    if (c === '"' || c === "'" || c === '`') {
      const triple = c !== '`' && text.slice(i, i + 3) === c.repeat(3);
      const delimiter = triple ? c.repeat(3) : c;
      i += delimiter.length;
      column += delimiter.length;
      let value = '',
        escaped = false,
        closed = false;
      while (i < text.length) {
        if (text.slice(i, i + delimiter.length) === delimiter) {
          i += delimiter.length;
          column += delimiter.length;
          closed = true;
          break;
        }
        if (text[i] === '\\') {
          escaped = true;
          value += text.slice(i, i + 2);
          i += 2;
          column += 2;
        } else {
          if (text[i] === '\n') {
            if (!triple) throw new SyntaxError('SCRIPT_STRING');
            line++;
            column = 0;
          } else column++;
          value += text[i++];
        }
      }
      if (!closed) throw new SyntaxError('SCRIPT_STRING');
      push(
        '<string>',
        atLine,
        atColumn,
        !escaped && name(value) ? value : undefined,
        !escaped && name(value) ? value : language === 'python' ? pythonString(value) : undefined,
      );
      continue;
    }
    const identifier = /^[A-Za-z_.][A-Za-z0-9_.]*/.exec(text.slice(i));
    const number = /^\d+(?:\.\d+)?/.exec(text.slice(i));
    const value =
      identifier?.[0] ??
      number?.[0] ??
      ((language === 'r'
        ? ['<-', '[[', ']]', '==', '!=', '>=', '<=', '+=', '-=']
        : ['==', '!=', '>=', '<=', '+=', '-=']
      ).includes(text.slice(i, i + 2))
        ? text.slice(i, i + 2)
        : c);
    push(value, atLine, atColumn);
    i += value.length;
    column += value.length;
  }
  const stack: string[] = [];
  for (const token of result) {
    if (['(', '[', '{', '[['].includes(token.value)) {
      if (stack.length >= 100) throw new RangeError('SCRIPT_DEPTH_LIMIT');
      stack.push(token.value);
    } else if ([')', ']', '}', ']]'].includes(token.value)) {
      if (
        stack.pop() !==
        ({ ')': '(', ']': '[', '}': '{', ']]': '[[' } as Record<string, string>)[token.value]
      )
        throw new SyntaxError('SCRIPT_BRACKETS');
    }
  }
  if (stack.length) throw new SyntaxError('SCRIPT_BRACKETS');
  return result;
}

function functions(all: Token[], language: 'python' | 'r'): Map<string, FunctionBody> {
  const result = new Map<string, FunctionBody>();
  for (let i = 0; i < all.length; i++) {
    let functionName: string, open: number;
    if (language === 'python') {
      if (all[i].value !== 'def' || all[i].column !== 0 || all[i + 2]?.value !== '(') continue;
      functionName = all[i + 1].value;
      open = i + 2;
    } else {
      if (
        !['<-', '='].includes(all[i + 1]?.value) ||
        all[i + 2]?.value !== 'function' ||
        all[i + 3]?.value !== '('
      )
        continue;
      functionName = all[i].value;
      open = i + 3;
    }
    const close = all.findIndex((token, j) => j > open && token.value === ')');
    if (close < 0) continue;
    if (!name(functionName)) throw new RangeError('SCRIPT_FUNCTION_NAME_LIMIT');
    const argument = all[open + 1]?.value !== ')' ? all[open + 1]?.value : undefined;
    let start = close + 1,
      end = start;
    if (language === 'python') {
      while (start < all.length && ![':', '\n'].includes(all[start].value)) start++;
      if (all[start]?.value !== ':') continue;
      start++;
      while (all[start]?.value === '\n') start++;
      end = start;
      while (end < all.length) {
        if (all[end].value !== '\n' && all[end].line > all[close].line && all[end].column === 0)
          break;
        end++;
      }
    } else {
      if (all[start]?.value !== '{') continue;
      let depth = 1;
      start++;
      end = start;
      while (end < all.length && depth) {
        if (all[end].value === '{') depth++;
        if (all[end].value === '}') depth--;
        if (depth) end++;
      }
    }
    if (result.size >= 100 || result.has(functionName))
      throw new RangeError('SCRIPT_FUNCTION_LIMIT');
    result.set(functionName, { argument, body: all.slice(start, end) });
    i = Math.max(i, end - 1);
  }
  return result;
}

function statements(body: Token[]): Token[][] {
  const result: Token[][] = [];
  let current: Token[] = [],
    depth = 0;
  for (const token of body) {
    if (['(', '[', '{', '[['].includes(token.value)) depth++;
    if ([')', ']', '}', ']]'].includes(token.value)) depth--;
    if (!depth && ['\n', ';'].includes(token.value)) {
      if (current.length) result.push(current);
      current = [];
    } else current.push(token);
  }
  if (current.length) result.push(current);
  return result;
}

function schema(
  body: Token[],
  language: 'python' | 'r',
): Record<string, PrepPhysicalType> | undefined {
  const values = body.filter((token) => token.value !== '\n');
  const constructor = language === 'python' ? 'DataFrame' : 'data.frame';
  const positions = values.flatMap((token, i) =>
    token.value === constructor || token.value.endsWith('.' + constructor) ? [i] : [],
  );
  if (positions.length !== 1) return;
  let i = positions[0] + 1;
  if (values[i++]?.value !== '(' || (language === 'python' && values[i++]?.value !== '{')) return;
  const fields = new Map<string, PrepPhysicalType>();
  let checkNames = true;
  const close = language === 'python' ? '}' : ')';
  while (i < values.length && values[i].value !== close) {
    const token = values[i++];
    if (language === 'r' && ['check.names', 'stringsAsFactors'].includes(token.value)) {
      if (values[i++]?.value !== '=' || !['TRUE', 'FALSE'].includes(values[i]?.value)) return;
      if (token.value === 'check.names') checkNames = values[i].value === 'TRUE';
      i++;
    } else {
      const field =
        token.literal ??
        (language === 'r' && /^[A-Za-z_.][A-Za-z0-9_.]*$/.test(token.value)
          ? token.value
          : undefined);
      if (
        !name(field) ||
        fields.has(field) ||
        values[i++]?.value !== (language === 'python' ? ':' : '=')
      )
        return;
      const datatype = own(types, values[i++]?.value);
      if (!datatype || values[i++]?.value !== '(' || values[i++]?.value !== ')') return;
      if (fields.size >= 5000) throw new RangeError('SCRIPT_FIELD_LIMIT');
      fields.set(field, datatype);
    }
    if (values[i]?.value === ',') i++;
    else if (values[i]?.value !== close) return;
  }
  if (!fields.size || values[i]?.value !== close) return;
  if (
    language === 'r' &&
    checkNames &&
    [...fields.keys()].some(
      (field) =>
        !/^(?:[A-Za-z]|\.(?![0-9]))[A-Za-z0-9._]*$/.test(field) ||
        [
          'if',
          'else',
          'repeat',
          'while',
          'function',
          'for',
          'in',
          'next',
          'break',
          'TRUE',
          'FALSE',
          'NULL',
          'Inf',
          'NaN',
          'NA',
          'NA_integer_',
          'NA_real_',
          'NA_complex_',
          'NA_character_',
        ].includes(field),
    )
  )
    return;
  return Object.fromEntries(fields);
}

function functionEvidence(
  fn: FunctionBody,
  language: 'python' | 'r',
): PrepScriptAnalysis['functions'][string] {
  const lines = statements(fn.body),
    outputs = new Map<string, { inputs: string[]; status: 'static' | 'candidate' }>();
  const reads = new Set<string>();
  const dynamicTokens = language === 'r' ? fn.body : lines.flatMap((line) => line.slice(0, 1));
  const dynamic = dynamicTokens.some((token) =>
    [
      'if',
      'for',
      'while',
      'repeat',
      'eval',
      'source',
      'get',
      'assign',
      'try',
      'with',
      'lambda',
      'def',
      'async',
      'await',
      'yield',
      'del',
      'global',
      'nonlocal',
      'class',
      'import',
      'from',
      'raise',
    ].includes(token.value),
  );
  const refs = (expression: Token[]): { inputs: string[]; known: boolean } => {
    const selected = new Set<string>();
    let known = !dynamic;
    for (let i = 0; i < expression.length; i++) {
      const token = expression[i];
      if (language === 'python' && ['lambda', 'for', 'await'].includes(token.value)) known = false;
      if (
        expression[i + 1]?.value === '(' &&
        /^[A-Za-z_.]/.test(token.value) &&
        token.value !== 'return'
      )
        known = false;
      if (token.value !== fn.argument) {
        if (fn.argument && token.value.startsWith(fn.argument + '.')) known = false;
        continue;
      }
      const selector = expression[i + 1]?.value;
      let field: string | undefined;
      if (language === 'r' && selector === '$')
        field =
          expression[i + 2]?.literal ??
          (expression[i + 2]?.value !== '<string>' ? expression[i + 2]?.value : undefined);
      else if (selector === (language === 'r' ? '[[' : '[')) {
        if (expression[i + 3]?.value === (language === 'r' ? ']]' : ']'))
          field = language === 'python' ? expression[i + 2]?.reference : expression[i + 2]?.literal;
        if (!field) known = false;
      }
      if (name(field)) {
        const previous = outputs.get(field);
        if (previous?.status === 'candidate') known = false;
        for (const value of previous?.inputs ?? [field]) selected.add(value);
      } else if (['[', '[[', '$'].includes(selector)) known = false;
    }
    return { inputs: [...selected].sort(), known };
  };
  for (const line of lines) {
    const values = line.map((token) => token.value);
    if (
      language === 'python' &&
      values[0] === fn.argument &&
      values[1] === '[' &&
      values[3] === ']' &&
      values[4] === ':'
    )
      continue;
    let target: string | undefined,
      offset = 0;
    if (line[0]?.value === fn.argument) {
      if (language === 'python' && values[1] === '[' && values[3] === ']' && values[4] === '=') {
        target = line[2].reference;
        offset = 5;
      }
      if (language === 'r' && values[1] === '$' && ['<-', '='].includes(values[3])) {
        target = line[2].literal ?? line[2].value;
        offset = 4;
      }
      if (
        language === 'r' &&
        values[1] === '[[' &&
        values[3] === ']]' &&
        ['<-', '='].includes(values[4])
      ) {
        target = line[2].literal;
        offset = 5;
      }
    }
    if (name(target)) {
      const result = refs(line.slice(offset));
      result.inputs.forEach((value) => reads.add(value));
      outputs.set(target, { inputs: result.inputs, status: result.known ? 'static' : 'candidate' });
    } else {
      const result = refs(line);
      result.inputs.forEach((value) => reads.add(value));
      // Native Python supports a literal returned DataFrame as well as in-place writes.
      if (
        language === 'python' &&
        values[0] === 'return' &&
        values.some((v) => v === 'DataFrame' || v.endsWith('.DataFrame'))
      ) {
        for (let i = 0; i < line.length - 1; i++)
          if (line[i].reference && values[i + 1] === ':') {
            let end = i + 2,
              depth = 0;
            while (end < line.length) {
              if (['(', '[', '{'].includes(values[end])) depth++;
              if ([')', ']', '}'].includes(values[end])) {
                if (!depth) break;
                depth--;
              }
              if (!depth && values[end] === ',') break;
              end++;
            }
            const value = refs(line.slice(i + 2, end));
            value.inputs.forEach((field) => reads.add(field));
            outputs.set(line[i].reference!, {
              inputs: value.inputs,
              status: value.known ? 'static' : 'candidate',
            });
          }
      }
    }
    if (outputs.size > 5000) throw new RangeError('SCRIPT_OUTPUT_LIMIT');
  }
  const flat = fn.body
    .filter((token) => !['\n', ';'].includes(token.value))
    .map((token) => token.value);
  const identity =
    language === 'python' ? ['return', fn.argument] : ['return', '(', fn.argument, ')'];
  return {
    inputFields: [...reads].sort(),
    outputs: Object.fromEntries(outputs),
    returnsInput:
      flat.length === identity.length && flat.every((value, i) => value === identity[i]),
    dependencyStatus: dynamic ? 'dynamic' : 'partial-static',
  };
}

export function analyzePrepScript(bytes: Buffer, language: 'python' | 'r'): PrepScriptAnalysis {
  const result: PrepScriptAnalysis = {
    language,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    fields: {},
    schemaStatus: 'limited',
    functions: {},
    nativeExecutionVerified: false,
  };
  if (bytes.length > MAX_PREP_SCRIPT_BYTES) return result;
  try {
    const all = tokens(new TextDecoder('utf-8', { fatal: true }).decode(bytes), language);
    if (!all.length) return result;
    const bodies = functions(all, language);
    const getter = bodies.get(language === 'python' ? 'get_output_schema' : 'getOutputSchema');
    const fields = getter ? schema(getter.body, language) : undefined;
    result.fields = fields ?? {};
    result.schemaStatus = getter ? (fields ? 'static-declaration' : 'dynamic') : 'missing';
    result.functions = Object.fromEntries(
      [...bodies]
        .filter(([, fn]) => fn.argument)
        .map(([key, fn]) => [key, functionEvidence(fn, language)]),
    );
  } catch (error) {
    result.fields = {};
    result.functions = {};
    result.schemaStatus = error instanceof RangeError ? 'limited' : 'invalid-or-dynamic';
  }
  return result;
}
