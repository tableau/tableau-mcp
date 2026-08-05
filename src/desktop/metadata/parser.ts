import { randomUUID } from 'crypto';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

import { xmlNamesEqual } from '../xmlElement.js';
import type { ParsedWorkbook, ParsedWorksheet } from './types.js';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  ignoreNameSpace: false,
  removeNSPrefix: false,
  parseTagValue: false,
  parseNodeValue: false,
  // Preserve text whitespace: workbook <run> nodes (formatted titles/tooltips) carry
  // significant leading/trailing spaces, and a single-sheet apply re-serializes the whole
  // workbook — trimming would silently corrupt that text on untouched sibling sheets.
  trimValues: false,
  parseTrueNumberOnly: false,
  arrayMode: false,
  alwaysCreateTextNode: false,
  // Raised limits to handle real workbooks with many formulas/captions using &apos;/&quot;
  processEntities: {
    enabled: true,
    maxTotalExpansions: 1_000_000,
    maxExpandedLength: 100_000_000,
  },
  isArray: (name: string, _jPath: unknown, _isLeafNode: boolean, _isAttribute: boolean) => {
    const arrayElements = [
      'worksheet',
      'window',
      'pane',
      'column',
      'column-instance',
      'card',
      'strip',
      'edge',
      'zone',
      'format',
    ];
    return arrayElements.includes(name);
  },
};

// Escape the genuine XML metacharacters (`&`, `<`, `>`) WITHOUT clobbering a numeric
// character reference the parser deliberately left intact.
//
// Why this is needed: the parser decodes the five predefined named entities
// (`&amp;`/`&lt;`/`&gt;`/`&quot;`/`&apos;`) to their literal characters but leaves NUMERIC
// character references (`&#13;`, `&#10;`, `&#9;`, `&#xNN;`) as literal `&#…;` text. Tableau
// stores newlines *inside* attribute values — most importantly multi-line calc `formula`s
// with `//` line comments — as `&#13;&#10;`, precisely because XML attribute-value
// normalization would otherwise fold a literal newline into a single space and merge the
// comment into the next line (breaking the calc). A default builder re-escapes the `&` of
// that surviving `&#13;` into `&amp;#13;`, so Tableau reads the literal text `&#13;` instead
// of a newline and the whole calc errors out. The negative lookahead below leaves an
// already-formed numeric reference untouched while still escaping every real `&`.
const NUMERIC_ENTITY_LOOKAHEAD = /&(?!#\d+;|#x[0-9a-fA-F]+;)/g;
function escapeXmlCore(value: unknown): string {
  return String(value)
    .replace(NUMERIC_ENTITY_LOOKAHEAD, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
// Escape `"` in both attributes and text: it is only strictly required inside a
// double-quoted attribute, but the previous builder escaped it in text too (group-definition
// `<value>"Acme"</value>` members round-trip as `&quot;…&quot;`), so we match that to keep the
// only behavioural change the numeric-reference preservation above.
function escapeAttributeValue(_name: string, value: unknown): string {
  return escapeXmlCore(value).replace(/"/g, '&quot;');
}
function escapeTextValue(_name: string, value: unknown): string {
  return escapeXmlCore(value).replace(/"/g, '&quot;');
}

const builderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: false,
  suppressBooleanAttributes: false,
  arrayNodeName: '',
  // We fully own entity escaping via the processors below (see escapeXmlCore) so that numeric
  // character references such as `&#13;&#10;` survive the round-trip; disable the builder's
  // own entity processing to avoid double-escaping.
  processEntities: false,
  attributeValueProcessor: escapeAttributeValue,
  tagValueProcessor: escapeTextValue,
};

const parser = new XMLParser(parserOptions);
const builder = new XMLBuilder(builderOptions);

export function parseXML(xmlString: string): ParsedWorkbook {
  try {
    return parser.parse(xmlString) as ParsedWorkbook;
  } catch (error) {
    throw new Error(
      `Failed to parse XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function serializeXML(obj: any): string {
  try {
    const result = builder.build(obj);
    if (typeof result === 'string') {
      return result.trim();
    }
    throw new Error('XMLBuilder returned an object instead of a string');
  } catch (error) {
    throw new Error(
      `Failed to serialize XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

export function findWorksheet(workbook: ParsedWorkbook, sheetName: string): ParsedWorksheet | null {
  const worksheets = normalizeArray(workbook.workbook?.worksheets?.worksheet);
  return worksheets.find((ws) => ws['@_name'] && xmlNamesEqual(ws['@_name'], sheetName)) || null;
}

export function findAllWorksheets(workbook: ParsedWorkbook): ParsedWorksheet[] {
  return normalizeArray(workbook.workbook?.worksheets?.worksheet);
}

// fast-xml-parser attaches an `xmlns`/`xmlns:*` declaration as a plain attribute on whichever
// element declares it — typically the <workbook> root (e.g. `xmlns:user`). Lifting a subtree
// (a <worksheet> or <dashboard>) out of the document with a naive `{ worksheet }` re-serialize
// drops that declaration even though descendants of the subtree may use the prefix (e.g.
// `user:ui-enumeration` on a level-members groupfilter) — the extracted fragment is then
// namespace-invalid on its own, even though it was never modified. Call this before serializing
// an extracted subtree to carry ancestor namespace declarations forward onto its root, without
// overwriting a declaration the subtree already carries itself.
export function carryNamespaceDeclarations<T extends Record<string, any>>(
  ancestor: Record<string, any> | undefined,
  element: T,
): T {
  if (!ancestor) return element;
  const target: Record<string, any> = element;
  for (const key of Object.keys(ancestor)) {
    if ((key === '@_xmlns' || key.startsWith('@_xmlns:')) && !(key in target)) {
      target[key] = ancestor[key];
    }
  }
  return element;
}

export function generateUUID(): string {
  const uuid = randomUUID();
  return `{${uuid.toUpperCase()}}`;
}
