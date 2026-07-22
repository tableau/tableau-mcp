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
