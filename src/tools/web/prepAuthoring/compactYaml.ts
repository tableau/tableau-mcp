/*! YAML 1.1 scalar rules derived from PyYAML (MIT).
Copyright (c) 2017-2021 Ingy döt Net
Copyright (c) 2006-2016 Kirill Simonov

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { randomUUID } from 'node:crypto';

import * as yaml from 'js-yaml';

import { AuthoringError, MAX_FILE, MAX_ITEMS, MAX_YAML } from './projectIo.js';
import scalarRules from './scalarRules.json';

export type Json = null | boolean | string | number | bigint | Json[] | { [key: string]: Json };
export type Obj = { [key: string]: Json };
const floatFields = new WeakMap<object, Set<string>>();
export function markFloatField(container: object, key: string): void {
  if (!floatFields.has(container)) floatFields.set(container, new Set());
  floatFields.get(container)!.add(key);
}
export const isFloatField = (container: unknown, key: string): boolean =>
  container !== null && typeof container === 'object' && !!floatFields.get(container)?.has(key);
function floatText(value: number): string {
  if (Object.is(value, -0)) return '-0.0';
  const text = String(value);
  return /[.eE]/.test(text) ? text : text + '.0';
}
export const isObject = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function object(value: unknown): Obj {
  if (!isObject(value)) throw new AuthoringError();
  return value;
}
export function ensureJson(value: Json): void {
  const stack: [Json, number][] = [[value, 0]];
  let budget = MAX_ITEMS;
  while (stack.length) {
    const [item, depth] = stack.pop()!;
    if (typeof item === 'string' && /\p{Surrogate}/u.test(item)) throw new AuthoringError();
    if (--budget < 0 || depth > 100) throw new AuthoringError();
    if (Array.isArray(item))
      stack.push(...item.map((value) => [value, depth + 1] as [Json, number]));
    else if (isObject(item)) {
      if (Object.keys(item).some((key) => /\p{Surrogate}/u.test(key))) throw new AuthoringError();
      if (![null, Object.prototype].includes(Object.getPrototypeOf(item)))
        throw new AuthoringError();
      stack.push(...Object.values(item).map((value) => [value, depth + 1] as [Json, number]));
    } else if (
      !(
        item === null ||
        ['boolean', 'string', 'bigint'].includes(typeof item) ||
        (typeof item === 'number' && Number.isFinite(item))
      )
    )
      throw new AuthoringError();
  }
}
export function jsonBytes(value: Json): Buffer {
  ensureJson(value);
  const api = JSON as typeof JSON & { rawJSON(value: string): unknown };
  const text = JSON.stringify(value, function (this: unknown, key, item: unknown) {
    if (typeof item === 'bigint') return api.rawJSON(item.toString());
    return typeof item === 'number' && isFloatField(this, key)
      ? api.rawJSON(floatText(item))
      : item;
  });
  if (text === undefined || Buffer.byteLength(text) + 1 > MAX_FILE) throw new AuthoringError();
  return Buffer.from(text + '\n');
}
function decimal(raw: string): string {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!match || (!match[2] && !match[3])) throw new AuthoringError('NUMERIC_PRECISION_UNSUPPORTED');
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, ''),
    exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!digits) return '0';
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  return (match[1] === '-' ? '-' : '') + digits + 'e' + exponent;
}
export function normalizePythonWhitespace(value: string): string {
  return value.replace(/[\p{Cc}\uFEFF]/gu, (character) => {
    const code = character.charCodeAt(0);
    if ((code >= 28 && code <= 31) || code === 133) return ' ';
    return code === 65279 ? '\0' : character;
  });
}
function unicodeDigits(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    if (code < 128) return character;
    const zero = scalarRules.decimalZeroCodepoints.find((zero) => code >= zero && code < zero + 10);
    return zero === undefined ? character : String(code - zero);
  }).join('');
}
function integerPart(value: string, radix: number): bigint {
  value = unicodeDigits(normalizePythonWhitespace(value).trim());
  let sign = 1n;
  if (value.startsWith('-')) sign = -1n;
  if (/^[+-]/.test(value)) value = value.slice(1);
  const prefix = radix === 2 ? 'b' : radix === 8 ? 'o' : radix === 16 ? 'x' : undefined;
  if (prefix && value.slice(0, 2).toLowerCase() === '0' + prefix) value = value.slice(2);
  const valid =
    radix === 2
      ? /^[01]+$/
      : radix === 8
        ? /^[0-7]+$/
        : radix === 16
          ? /^[0-9a-fA-F]+$/
          : /^[0-9]+$/;
  if (!valid.test(value)) throw new AuthoringError();
  return sign * BigInt((prefix ? '0' + prefix : '') + value);
}
function numberValue(raw: string, integer: boolean): number | bigint {
  raw = raw.replaceAll('_', '');
  if (integer) {
    if (!raw) throw new AuthoringError();
    let sign = 1n;
    if (raw.startsWith('-')) sign = -1n;
    if (/^[+-]/.test(raw)) raw = raw.slice(1);
    let value: bigint;
    if (raw.startsWith('0b')) value = integerPart(raw.slice(2), 2);
    else if (raw.startsWith('0x')) value = integerPart(raw.slice(2), 16);
    else if (raw.startsWith('0')) value = integerPart(raw, 8);
    else if (raw.includes(':'))
      value = raw.split(':').reduce((n, part) => n * 60n + integerPart(part, 10), 0n);
    else value = integerPart(raw, 10);
    value *= sign;
    return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)
      ? value
      : Number(value);
  }
  raw = unicodeDigits(normalizePythonWhitespace(raw).trim());
  const value = Number(raw);
  if (!Number.isFinite(value) || decimal(raw) !== decimal(String(value)))
    throw new AuthoringError('NUMERIC_PRECISION_UNSUPPORTED');
  return value;
}
/** A bounded JSON reader retains arbitrary integers and rejects duplicate keys/rounded floats. */
export function parseJsonTyped(bytes: Buffer): { value: Json; float: boolean } {
  if (bytes.length > MAX_FILE) throw new AuthoringError();
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    .decode(bytes)
    .replace(/^\uFEFF/, '');
  let offset = 0,
    budget = MAX_ITEMS,
    floating = false;
  const whitespace = (): void => {
    while (/[\t\n\r ]/.test(text[offset] ?? 'x')) offset++;
  };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const ch = text[offset++];
      if (ch === '\\') offset++;
      else if (ch === '"') return JSON.parse(text.slice(start, offset)) as string;
    }
    throw new AuthoringError();
  };
  const read = (depth: number): Json => {
    floating = false;
    if (depth > 100 || --budget < 0) throw new AuthoringError();
    whitespace();
    const ch = text[offset];
    if (ch === '"') return string();
    if (ch === '{' || ch === '[') {
      offset++;
      whitespace();
      const result: Obj | Json[] = ch === '{' ? (Object.create(null) as Obj) : [];
      const end = ch === '{' ? '}' : ']';
      if (text[offset] === end) {
        offset++;
        return result;
      }
      for (;;) {
        whitespace();
        if (ch === '{') {
          if (text[offset] !== '"') throw new AuthoringError();
          const key = string();
          whitespace();
          if (text[offset++] !== ':' || Object.hasOwn(result, key)) throw new AuthoringError();
          const value = read(depth + 1);
          (result as Obj)[key] = value;
          if (typeof value === 'number' && floating) markFloatField(result, key);
        } else {
          const values = result as Json[],
            value = read(depth + 1);
          if (typeof value === 'number' && floating) markFloatField(values, String(values.length));
          values.push(value);
        }
        whitespace();
        if (text[offset] === end) {
          offset++;
          return result;
        }
        if (text[offset++] !== ',') throw new AuthoringError();
      }
    }
    for (const [token, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const)
      if (text.startsWith(token, offset)) {
        offset += token.length;
        return value;
      }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(offset));
    if (!match) throw new AuthoringError();
    offset += match[0].length;
    floating = /[.eE]/.test(match[0]);
    return numberValue(match[0], !floating);
  };
  const value = read(0);
  whitespace();
  if (offset !== text.length) throw new AuthoringError();
  return { value, float: typeof value === 'number' && floating };
}
export const parseJson = (bytes: Buffer): Json => parseJsonTyped(bytes).value;

// Wrapping non-string YAML keys prevents js-yaml's JavaScript key coercion.
class YamlValue {
  readonly [Symbol.toStringTag] = 'PrepYamlValue';
  constructor(
    readonly value: unknown,
    readonly float = false,
  ) {}
  toString(): never {
    throw new AuthoringError();
  }
}
type Reference = { kind: 'id' | 'include' | 'path'; value: string };
class DumpFloat {
  constructor(readonly value: number) {}
}
export class CompactYaml {
  private readonly refs = new Map<string, Reference>();
  private readonly names = new Map<string, string>();
  private readonly prefix = '\0' + randomUUID() + ':';
  private readonly parseSchema: yaml.Schema;
  private readonly dumpSchema: yaml.Schema;
  constructor() {
    const references = (['id', 'include', 'path'] as const).map(
      (kind) =>
        new yaml.Type('!' + kind, {
          kind: 'scalar',
          construct: (value) => {
            if (typeof value !== 'string' || !value || value.length > 4096)
              throw new AuthoringError();
            return this.ref(kind, value);
          },
          predicate: (value) => typeof value === 'string' && this.refs.get(value)?.kind === kind,
          represent: (value) => this.refs.get(value as string)!.value,
        }),
    );
    const scalarNames = ['null', 'bool', 'int', 'float'] as const;
    const resolveScalar = (
      name: keyof typeof scalarRules.resolvers,
      value: string | null,
    ): boolean => {
      const rule = scalarRules.resolvers[name];
      return new RegExp(rule.pattern, rule.ignoreCase ? 'i' : '').test(
        name === 'bool' ? (value ?? '').replace(/ſ/g, 's') : (value ?? ''),
      );
    };
    const implicit = scalarNames.map((name) => {
      const type = yaml.types[name];
      return new yaml.Type(type.tag, {
        kind: 'scalar',
        resolve: (value, explicitTag) => !!explicitTag || resolveScalar(name, value),
        construct: (value) => {
          let result: unknown;
          if (name === 'bool') {
            const text = String(value ?? '').toLowerCase();
            if (!['true', 'false', 'yes', 'no', 'on', 'off'].includes(text))
              throw new AuthoringError();
            result = ['true', 'yes', 'on'].includes(text);
          } else if (name === 'null') result = null;
          else result = numberValue(String(value ?? ''), name === 'int');
          return new YamlValue(result, name === 'float');
        },
      });
    });
    const rejected = (['merge', 'value', 'yaml'] as const).map(
      (name) =>
        new yaml.Type('tag:yaml.org,2002:' + name, {
          kind: 'scalar',
          resolve: (value) => resolveScalar(name, value),
          construct: () => {
            throw new AuthoringError();
          },
        }),
    );
    const wrapped = (['map', 'seq'] as const).map(
      (name) =>
        new yaml.Type(yaml.types[name].tag, {
          kind: name === 'map' ? 'mapping' : 'sequence',
          construct: (value) => new YamlValue(value ?? (name === 'map' ? {} : [])),
        }),
    );
    this.parseSchema = new yaml.Schema({
      implicit: [...implicit, ...rejected],
      explicit: [yaml.types.str, ...wrapped, ...references],
    });
    const bigint = new yaml.Type(yaml.types.int.tag, {
      kind: 'scalar',
      predicate: (value) => typeof value === 'bigint',
      represent: (value) => String(value),
    });
    const float = new yaml.Type(yaml.types.float.tag, {
      kind: 'scalar',
      predicate: (value) => value instanceof DumpFloat,
      represent: (value) => floatText((value as DumpFloat).value),
    });
    const dumpImplicit = scalarNames.map(
      (name) =>
        new yaml.Type(yaml.types[name].tag, {
          ...yaml.types[name].options,
          resolve: (value) => resolveScalar(name, value),
        }),
    );
    this.dumpSchema = new yaml.Schema({
      implicit: [...dumpImplicit, ...rejected],
      explicit: [yaml.types.str, yaml.types.map, yaml.types.seq, ...references, bigint, float],
    });
  }
  ref(kind: Reference['kind'], value: string): string {
    const name = kind + ':' + value;
    if (!this.names.has(name)) {
      const marker = this.prefix + this.names.size;
      this.names.set(name, marker);
      this.refs.set(marker, { kind, value });
    }
    return this.names.get(name)!;
  }
  reference(value: Json): Reference | undefined {
    return typeof value === 'string' ? this.refs.get(value) : undefined;
  }
  load(text: string): Obj {
    if (Buffer.byteLength(text) > MAX_YAML) throw new AuthoringError();
    let depth = 0,
      nodes = 0;
    const parsed = yaml.load(text, {
      schema: this.parseSchema,
      listener: (event, state) => {
        if (event === 'open') {
          if (++depth > 100 || ++nodes > MAX_ITEMS) throw new AuthoringError();
        } else {
          depth--;
          if (state.anchor !== null) throw new AuthoringError();
          if (
            ['mapping', 'sequence'].includes(state.kind ?? '') &&
            !(state.result instanceof YamlValue)
          )
            state.result = new YamlValue(state.result);
        }
      },
    });
    let budget = MAX_ITEMS;
    const unwrap = (value: unknown, depth: number): Json => {
      if (depth > 100 || --budget < 0) throw new AuthoringError();
      if (value instanceof YamlValue) value = value.value;
      if (Array.isArray(value)) {
        const result = value.map((v) => unwrap(v, depth + 1));
        value.forEach((v, i) => {
          if (v instanceof YamlValue && v.float) markFloatField(result, String(i));
        });
        return result;
      }
      if (isObject(value)) {
        const result = Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, unwrap(v, depth + 1)]),
        );
        for (const [k, v] of Object.entries(value))
          if (v instanceof YamlValue && v.float) markFloatField(result, k);
        return result;
      }
      if (value === null || ['boolean', 'number', 'string', 'bigint'].includes(typeof value))
        return value as Json;
      throw new AuthoringError();
    };
    return object(unwrap(parsed, 0));
  }
  dump(value: Obj): string {
    const decorate = (value: Json): unknown => {
      if (Array.isArray(value))
        return value.map((v, i) =>
          typeof v === 'number' && isFloatField(value, String(i)) ? new DumpFloat(v) : decorate(v),
        );
      if (isObject(value))
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            typeof v === 'number' && isFloatField(value, k) ? new DumpFloat(v) : decorate(v),
          ]),
        );
      return value;
    };
    const text = yaml.dump(decorate(value), {
      schema: this.dumpSchema,
      noRefs: true,
      lineWidth: 120,
      sortKeys: false,
      noCompatMode: true,
    });
    if (Buffer.byteLength(text) > MAX_YAML) throw new AuthoringError();
    return text;
  }
}
