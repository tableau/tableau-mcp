import { listAvailableFields } from './field-builder.js';
import { parseCanonicalColumnRef } from './field-resolver.js';
import { parseShelfValue } from './fields.js';
import { normalizeArray, parseXML } from './parser.js';
import type { ParsedWorksheet } from './types.js';

export type SearchWorkbookFieldMatchAttribute =
  | 'caption'
  | 'localName'
  | 'formula'
  | 'folder'
  | 'datasource';

export interface SearchWorkbookFieldPlacement {
  worksheet: string;
  location: 'rows' | 'columns' | 'encoding';
  encoding?: string;
}

export interface SearchWorkbookFieldMatch {
  datasource: string;
  caption: string;
  localName: string;
  columnRef: string;
  role: string;
  datatype?: string;
  formula?: string;
  matchedOn: SearchWorkbookFieldMatchAttribute[];
  placements: SearchWorkbookFieldPlacement[];
}

export interface SearchWorkbookFieldsResult {
  query: string;
  totalMatches: number;
  truncated: boolean;
  matches: SearchWorkbookFieldMatch[];
  usageScope: 'worksheet shelves and mark encodings only';
}

const MATCH_ATTRIBUTES: ReadonlyArray<
  readonly [SearchWorkbookFieldMatchAttribute, (field: AvailableField) => string | undefined]
> = [
  ['caption', (field) => field.caption],
  ['localName', (field) => localName(field.columnName)],
  ['formula', (field) => field.formula],
  ['folder', (field) => field.folder],
  ['datasource', (field) => field.datasource],
];

type AvailableField = ReturnType<typeof listAvailableFields>[number];

export function searchWorkbookFields(
  workbookXml: string,
  query: string,
  limit = 20,
): SearchWorkbookFieldsResult {
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const worksheets = normalizeArray(parseXML(workbookXml).workbook?.worksheets?.worksheet);
  const placementsByField = collectPlacements(worksheets);

  const matches = listAvailableFields(workbookXml)
    .map((field): SearchWorkbookFieldMatch | undefined => {
      const matchedOn = MATCH_ATTRIBUTES.filter(([, read]) =>
        read(field)?.toLowerCase().includes(normalizedQuery),
      ).map(([attribute]) => attribute);
      if (matchedOn.length === 0) return undefined;

      const fieldLocalName = localName(field.columnName);
      return {
        datasource: field.datasource,
        caption: field.caption ?? fieldLocalName,
        localName: fieldLocalName,
        columnRef: field.column_ref,
        role: field.role,
        ...(field.datatype !== undefined ? { datatype: field.datatype } : {}),
        ...(field.formula !== undefined ? { formula: field.formula } : {}),
        matchedOn,
        placements: placementsForField(placementsByField, field.datasource, fieldLocalName),
      };
    })
    .filter((match): match is SearchWorkbookFieldMatch => match !== undefined)
    .sort((left, right) =>
      compareText(
        `${left.datasource}\u0000${left.caption}\u0000${left.localName}\u0000${left.columnRef}`,
        `${right.datasource}\u0000${right.caption}\u0000${right.localName}\u0000${right.columnRef}`,
      ),
    );

  return {
    query: trimmedQuery,
    totalMatches: matches.length,
    truncated: matches.length > limit,
    matches: matches.slice(0, limit),
    usageScope: 'worksheet shelves and mark encodings only',
  };
}

type PlacementsByField = Map<string, Map<string, SearchWorkbookFieldPlacement>>;

function collectPlacements(worksheets: ParsedWorksheet[]): PlacementsByField {
  const placementsByField: PlacementsByField = new Map();

  for (const worksheet of worksheets) {
    const worksheetName = worksheet['@_name'];
    if (typeof worksheetName !== 'string') continue;

    for (const columnRef of parseShelfValue(worksheet.table?.rows)) {
      addPlacement(placementsByField, columnRef, {
        worksheet: worksheetName,
        location: 'rows',
      });
    }
    for (const columnRef of parseShelfValue(worksheet.table?.cols)) {
      addPlacement(placementsByField, columnRef, {
        worksheet: worksheetName,
        location: 'columns',
      });
    }

    for (const pane of normalizeArray(worksheet.table?.panes?.pane)) {
      const encodings = pane.encodings;
      if (typeof encodings !== 'object' || encodings === null) continue;
      for (const [encoding, entries] of Object.entries(encodings)) {
        for (const entry of normalizeArray(entries)) {
          const record =
            typeof entry === 'object' && entry !== null
              ? (entry as Record<string, unknown>)
              : undefined;
          const columnRef = record?.['@_column'];
          if (typeof columnRef === 'string') {
            addPlacement(placementsByField, columnRef, {
              worksheet: worksheetName,
              location: 'encoding',
              encoding,
            });
          }
        }
      }
    }
  }

  return placementsByField;
}

function placementsForField(
  placementsByField: PlacementsByField,
  datasource: string,
  fieldLocalName: string,
): SearchWorkbookFieldPlacement[] {
  return [...(placementsByField.get(fieldKey(datasource, fieldLocalName))?.values() ?? [])].sort(
    (left, right) =>
      compareText(
        `${left.worksheet}\u0000${left.location}\u0000${left.encoding ?? ''}`,
        `${right.worksheet}\u0000${right.location}\u0000${right.encoding ?? ''}`,
      ),
  );
}

function addPlacement(
  placementsByField: PlacementsByField,
  columnRef: string,
  placement: SearchWorkbookFieldPlacement,
): void {
  const parsed = parseCanonicalColumnRef(columnRef);
  if (!parsed) return;

  const key = fieldKey(parsed.datasource, parsed.localFieldName);
  const fieldPlacements = placementsByField.get(key) ?? new Map();
  fieldPlacements.set(
    `${placement.worksheet}\u0000${placement.location}\u0000${placement.encoding ?? ''}`,
    placement,
  );
  placementsByField.set(key, fieldPlacements);
}

function fieldKey(datasource: string, fieldLocalName: string): string {
  return `${datasource}\u0000${fieldLocalName}`;
}

function localName(columnName: string): string {
  return columnName.replace(/^\[|\]$/g, '');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
