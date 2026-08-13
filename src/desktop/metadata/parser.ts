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

const NUMERIC_ENTITY = /&#(\d+|x[0-9a-fA-F]+);/g;

const RAW_XML_SECTIONS = [
  { open: '<![CDATA[', close: ']]>' },
  { open: '<!--', close: '-->' },
  { open: '<?', close: '?>' },
] as const;

function nextRawXmlSection(
  xml: string,
  cursor: number,
): { start: number; open: string; close: string } | undefined {
  let next: { start: number; open: string; close: string } | undefined;
  for (const section of RAW_XML_SECTIONS) {
    const start = xml.indexOf(section.open, cursor);
    if (start !== -1 && (!next || start < next.start)) next = { start, ...section };
  }
  return next;
}

function numericEntityCharacter(body: string): string {
  const codePoint =
    body[0]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(1), 16) : Number(body);
  const isXmlCharacter =
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff);
  if (!Number.isInteger(codePoint) || !isXmlCharacter) {
    throw new Error(`Invalid XML numeric character reference: &#${body};`);
  }
  return String.fromCodePoint(codePoint);
}

function decodeNumericEntitySentinels(value: unknown, sentinel: RegExp): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string') {
      (value as Record<string, unknown>)[key] = child.replace(sentinel, (_match, body: string) =>
        numericEntityCharacter(body),
      );
    } else if (child && typeof child === 'object') {
      decodeNumericEntitySentinels(child, sentinel);
    }
  }
}

function protectNumericEntities(xml: string): { protectedXml: string; sentinel: RegExp } {
  let markerPrefix: string;
  do {
    markerPrefix = `\uE000TABLEAU_NUMERIC_ENTITY_${randomUUID()}_`;
  } while (xml.includes(markerPrefix));

  const protect = (segment: string): string =>
    segment.replace(NUMERIC_ENTITY, (_match, entityBody: string) => {
      return `${markerPrefix}${entityBody}\uE001`;
    });

  let cursor = 0;
  let transformed = '';
  while (cursor < xml.length) {
    const raw = nextRawXmlSection(xml, cursor);
    if (!raw) {
      transformed += protect(xml.slice(cursor));
      break;
    }
    transformed += protect(xml.slice(cursor, raw.start));
    const rawEnd = xml.indexOf(raw.close, raw.start + raw.open.length);
    if (rawEnd === -1) {
      transformed += xml.slice(raw.start);
      break;
    }
    const end = rawEnd + raw.close.length;
    transformed += xml.slice(raw.start, end);
    cursor = end;
  }

  const escapedPrefix = markerPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    protectedXml: transformed,
    sentinel: new RegExp(`${escapedPrefix}(\\d+|x[0-9a-fA-F]+)\uE001`, 'g'),
  };
}

function escapeXmlCore(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlValue(_name: string, value: unknown): string {
  return escapeXmlCore(value).replace(/"/g, '&quot;');
}

function escapeXmlText(_name: string, value: unknown): string {
  const text = String(value);
  // Formatting whitespace between XML elements is not Tableau content. Keeping it literal
  // avoids turning every pretty-printed line break into a numeric character reference.
  return /^\s+$/.test(text) ? text : escapeXmlCore(text).replace(/"/g, '&quot;');
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
};

const numericEntityPreservingBuilderOptions = {
  ...builderOptions,
  processEntities: false,
  attributeValueProcessor: escapeXmlValue,
  tagValueProcessor: escapeXmlText,
};

const parser = new XMLParser(parserOptions);
const numericEntityPreservingBuilder = new XMLBuilder(numericEntityPreservingBuilderOptions);

export function parseXML(xmlString: string): ParsedWorkbook {
  try {
    const { protectedXml, sentinel } = protectNumericEntities(xmlString);
    const parsed = parser.parse(protectedXml) as ParsedWorkbook;
    decodeNumericEntitySentinels(parsed, sentinel);
    return parsed;
  } catch (error) {
    throw new Error(
      `Failed to parse XML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function serializeXML(obj: any): string {
  try {
    const result = numericEntityPreservingBuilder.build(obj);
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
