import { createHash } from 'node:crypto';

import Ajv, { type AnySchema } from 'ajv';
import addFormats from 'ajv-formats';
import {
  createScanner,
  getNodeValue,
  type Node,
  type ParseError,
  parseTree,
  printParseErrorCode,
  SyntaxKind,
} from 'jsonc-parser/lib/esm/main.js';

import customThemeSchema from './CustomThemesSchema_1.0.0.json';

const sha256Pattern = /^[0-9a-f]{64}$/;
const maxThemeJsonBytes = 64 * 1024;
const maxJsonNestingDepth = 64;
const ajv = new Ajv({ allErrors: false, strict: true });
addFormats(ajv);
const validateCustomTheme = ajv.compile(customThemeSchema as AnySchema);

export type ParsedCustomTheme = {
  readonly value: Record<string, unknown>;
  readonly themeJson: string;
  readonly sha256: string;
  readonly commandFileName: string;
};

function assertBoundedJsonNesting(themeJson: string): void {
  const scanner = createScanner(themeJson);
  const openTokens: SyntaxKind[] = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) {
      if (openTokens.length === maxJsonNestingDepth) {
        throw new Error(
          `Custom Theme JSON exceeds maximum nesting depth of ${maxJsonNestingDepth}`,
        );
      }
      openTokens.push(token);
      continue;
    }

    const expectedOpenToken =
      token === SyntaxKind.CloseBraceToken
        ? SyntaxKind.OpenBraceToken
        : token === SyntaxKind.CloseBracketToken
          ? SyntaxKind.OpenBracketToken
          : undefined;
    if (
      expectedOpenToken !== undefined &&
      openTokens[openTokens.length - 1] === expectedOpenToken
    ) {
      openTokens.pop();
    }
  }
}

type TraversalFrame = {
  readonly node: Node;
  readonly keys: Set<string> | undefined;
  nextChildIndex: number;
};

function traversalFrame(node: Node): TraversalFrame {
  return {
    node,
    keys: node.type === 'object' ? new Set<string>() : undefined,
    nextChildIndex: 0,
  };
}

function hasDuplicateProperty(root: Node): boolean {
  const stack = [traversalFrame(root)];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const children = frame.node.children ?? [];
    if (frame.nextChildIndex >= children.length) {
      stack.pop();
      continue;
    }

    const childIndex = frame.nextChildIndex;
    frame.nextChildIndex += 1;
    if (frame.node.type === 'array') {
      stack.push(traversalFrame(children[childIndex]));
      continue;
    }
    if (frame.node.type !== 'object' || frame.keys === undefined) {
      continue;
    }

    const property = children[childIndex];
    const keyNode = property.children?.[0];
    const valueNode = property.children?.[1];
    if (keyNode === undefined || valueNode === undefined) {
      continue;
    }
    const keyValue: unknown = getNodeValue(keyNode);
    if (typeof keyValue !== 'string') {
      continue;
    }

    if (frame.keys.has(keyValue)) {
      return true;
    }
    frame.keys.add(keyValue);
    stack.push(traversalFrame(valueNode));
  }
  return false;
}

function syntaxErrorMessage(error: ParseError): string {
  return `Custom Theme JSON is invalid (${printParseErrorCode(error.error)} at byte offset ${error.offset})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCustomThemeJson(themeJson: string, expectedSha256: string): ParsedCustomTheme {
  if (Buffer.byteLength(themeJson, 'utf8') > maxThemeJsonBytes) {
    throw new Error(`Custom Theme JSON exceeds ${maxThemeJsonBytes} UTF-8 bytes`);
  }
  if (themeJson.charCodeAt(0) === 0xfeff) {
    throw new Error('Custom Theme JSON must not contain a byte-order mark');
  }
  assertBoundedJsonNesting(themeJson);

  const diagnostics: ParseError[] = [];
  const root = parseTree(themeJson, diagnostics, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (diagnostics.length > 0) {
    throw new Error(syntaxErrorMessage(diagnostics[0]));
  }
  if (root === undefined || root.type !== 'object') {
    throw new Error('Custom Theme JSON root must be an object');
  }

  if (hasDuplicateProperty(root)) {
    throw new Error('Custom Theme JSON contains a duplicate property');
  }

  const value: unknown = getNodeValue(root);
  if (!isRecord(value)) {
    throw new Error('Custom Theme JSON root must be an object');
  }
  if (!validateCustomTheme(value)) {
    const schemaError = validateCustomTheme.errors?.[0];
    const keyword = schemaError?.keyword ?? 'unknown';
    throw new Error(`Custom Theme schema validation failed (${keyword})`);
  }

  if (!sha256Pattern.test(expectedSha256)) {
    throw new Error('Expected SHA-256 must be a lowercase 64-character digest');
  }
  const sha256 = createHash('sha256').update(Buffer.from(themeJson, 'utf8')).digest('hex');
  if (sha256 !== expectedSha256) {
    throw new Error('Custom Theme SHA-256 does not match the exact UTF-8 source');
  }

  return {
    value,
    themeJson,
    sha256,
    commandFileName: `studio-theme-${sha256.slice(0, 12)}`,
  };
}
