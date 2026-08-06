import { createHash } from 'crypto';

import { parseInstanceRef } from '../templates/bookmarkTemplate.js';
import { listAvailableFields } from './field-builder.js';
import { carryNamespaceDeclarations, findWorksheet, normalizeArray, parseXML } from './parser.js';
import type { ParsedWindow } from './types.js';

export type TargetElementState = { state: 'absent' } | { state: 'present'; sha256: string };

export interface TargetWorksheetState {
  worksheetName: string;
  target: TargetElementState;
  targetWindow: TargetElementState;
  dependenciesSha256: string;
}

export type TargetWorksheetDriftReason =
  | 'target-worksheet-drift'
  | 'target-window-drift'
  | 'datasource-drift';

export type TargetWorksheetStateComparison =
  | { ok: true }
  | { ok: false; reasons: TargetWorksheetDriftReason[] };

interface FieldKey {
  datasource: string;
  field: string;
}

const TABLEAU_IMPLICIT_GENERATED_FIELDS = new Set([
  'Latitude (generated)',
  'Longitude (generated)',
  'Geometry (generated)',
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function removeInsignificantXmlWhitespace(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeInsignificantXmlWhitespace);
  if (value === null || typeof value !== 'object') return value;
  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, child]) => !(key === '#text' && typeof child === 'string' && child.trim() === ''),
      )
      .map(([key, child]) => [key, removeInsignificantXmlWhitespace(child)]),
  );
  return Object.keys(normalized).length === 0 ? '' : normalized;
}

function stableStringify(value: unknown): string {
  const sort = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(sort);
    if (current !== null && typeof current === 'object') {
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, sort(child)]),
      );
    }
    return current;
  };
  return JSON.stringify(sort(removeInsignificantXmlWhitespace(value)));
}

function collectUsedNamespacePrefixes(value: unknown, prefixes: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectUsedNamespacePrefixes(item, prefixes);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '@_xmlns' || key.startsWith('@_xmlns:')) continue;
    const xmlName = key.startsWith('@_') ? key.slice(2) : key;
    const separator = xmlName.indexOf(':');
    if (separator > 0) prefixes.add(xmlName.slice(0, separator));
    collectUsedNamespacePrefixes(child, prefixes);
  }
}

function relevantNamespaces(
  ancestor: Record<string, unknown> | undefined,
  prefixes: Set<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(ancestor ?? {}).filter(
      ([key]) => key === '@_xmlns' || (key.startsWith('@_xmlns:') && prefixes.has(key.slice(8))),
    ),
  );
}

function removeNamespaceDeclarations(element: Record<string, unknown>): void {
  for (const key of Object.keys(element)) {
    if (key === '@_xmlns' || key.startsWith('@_xmlns:')) delete element[key];
  }
}

function worksheetState(workbookXml: string, worksheetName: string): TargetElementState {
  const workbook = parseXML(workbookXml);
  const worksheet = findWorksheet(workbook, worksheetName);
  if (!worksheet) return { state: 'absent' };
  const prefixes = new Set<string>();
  collectUsedNamespacePrefixes(worksheet, prefixes);
  carryNamespaceDeclarations(
    {
      ...relevantNamespaces(workbook.workbook, prefixes),
      ...relevantNamespaces(workbook.workbook?.worksheets, prefixes),
    },
    worksheet,
  );
  return { state: 'present', sha256: sha256(stableStringify(worksheet)) };
}

function windowState(workbookXml: string, worksheetName: string): TargetElementState {
  const workbook = parseXML(workbookXml);
  const worksheetWindows = normalizeArray<ParsedWindow>(workbook.workbook?.windows?.window).filter(
    (candidate) =>
      candidate['@_class'] === undefined ||
      candidate['@_class'] === '' ||
      candidate['@_class'] === 'worksheet',
  );
  const matchedName = worksheetWindows.find((candidate) => candidate['@_name'] === worksheetName)?.[
    '@_name'
  ];
  const windows = worksheetWindows.filter(
    (candidate) => matchedName !== undefined && candidate['@_name'] === matchedName,
  );
  if (windows.length === 0) return { state: 'absent' };
  const structural = windows.map((window) => {
    const stripVolatileNavigation = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripVolatileNavigation);
      if (value === null || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(
            ([key]) =>
              key !== '@_active' &&
              key !== '@_maximized' &&
              key !== 'active' &&
              key !== 'simple-id',
          )
          .map(([key, child]) => [key, stripVolatileNavigation(child)]),
      );
    };
    const candidate = stripVolatileNavigation(window) as Record<string, unknown>;
    const prefixes = new Set<string>();
    collectUsedNamespacePrefixes(candidate, prefixes);
    const local = relevantNamespaces(candidate, prefixes);
    removeNamespaceDeclarations(candidate);
    carryNamespaceDeclarations(
      {
        ...relevantNamespaces(workbook.workbook, prefixes),
        ...relevantNamespaces(workbook.workbook?.windows, prefixes),
        ...local,
      },
      candidate,
    );
    return candidate;
  });
  return { state: 'present', sha256: sha256(stableStringify(structural)) };
}

function parseBracketSegment(
  value: string,
  start: number,
): { identifier: string; end: number } | null {
  if (value[start] !== '[') return null;
  let identifier = '';
  for (let index = start + 1; index < value.length; index++) {
    if (value[index] !== ']') {
      identifier += value[index];
      continue;
    }
    if (value[index + 1] === ']') {
      identifier += ']';
      index += 1;
      continue;
    }
    return { identifier, end: index + 1 };
  }
  return null;
}

function qualifiedReferences(value: string): Array<{ datasource: string; instance: string }> {
  const references: Array<{ datasource: string; instance: string }> = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '[') continue;
    const datasource = parseBracketSegment(value, index);
    if (!datasource || value.slice(datasource.end, datasource.end + 2) !== '.[') continue;
    const field = parseBracketSegment(value, datasource.end + 1);
    if (!field)
      throw new Error(`Malformed datasource-qualified reference near ${value.slice(index)}`);
    references.push({ datasource: datasource.identifier, instance: field.identifier });
    index = field.end - 1;
  }
  return references;
}

function collectReferenceStrings(value: unknown, strings: string[]): void {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectReferenceStrings(child, strings);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'datasource-dependencies') collectReferenceStrings(child, strings);
    }
  }
}

function normalizedFieldName(value: string): string {
  const parsed = parseBracketSegment(value, 0);
  return parsed && parsed.end === value.length ? parsed.identifier : value;
}

function addFieldKey(keys: Map<string, FieldKey>, datasource: string, field: string): void {
  keys.set(`${datasource}\u0000${field}`, { datasource, field });
}

function collectIncomingFieldKeys(worksheetXml: string): {
  keys: Map<string, FieldKey>;
  localCalculations: Map<string, unknown>;
} {
  const parsed = parseXML(worksheetXml);
  const worksheet = normalizeArray(parsed.worksheet as Record<string, any> | undefined)[0];
  if (!worksheet) throw new Error('Expected a standalone worksheet XML fragment.');
  const blocks = normalizeArray<Record<string, any>>(
    worksheet.table?.view?.['datasource-dependencies'],
  );
  const blocksByDatasource = new Map<string, Record<string, any>>();
  const localCalculations = new Map<string, unknown>();
  for (const block of blocks) {
    const datasource = block['@_datasource'];
    if (typeof datasource !== 'string' || datasource.length === 0) continue;
    blocksByDatasource.set(datasource, block);
    for (const column of normalizeArray<Record<string, any>>(block.column)) {
      const field = normalizedFieldName(column['@_name'] ?? '');
      if (field && column.calculation !== undefined) {
        localCalculations.set(`${datasource}\u0000${field}`, column.calculation);
      }
    }
  }

  const strings: string[] = [];
  collectReferenceStrings(worksheet, strings);
  const keys = new Map<string, FieldKey>();
  for (const reference of strings.flatMap(qualifiedReferences)) {
    const block = blocksByDatasource.get(reference.datasource);
    const declaration = normalizeArray<Record<string, any>>(block?.['column-instance']).find(
      (candidate) => normalizedFieldName(candidate['@_name'] ?? '') === reference.instance,
    );
    const declaredColumn = declaration?.['@_column'];
    const field =
      typeof declaredColumn === 'string' && declaredColumn.length > 0
        ? normalizedFieldName(declaredColumn)
        : parseInstanceRef(`[${reference.instance}]`).base;
    if (field) addFieldKey(keys, reference.datasource, field);
  }
  return { keys, localCalculations };
}

function calculationDependencies(calculation: unknown, defaultDatasource: string): FieldKey[] {
  const strings: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (
        (key === '@_formula' || key === '@_column' || key === '@_expression') &&
        typeof child === 'string'
      ) {
        strings.push(child);
      } else {
        visit(child);
      }
    }
  };
  visit(calculation);
  const dependencies = new Map<string, FieldKey>();
  for (const value of strings) {
    for (const reference of qualifiedReferences(value)) {
      addFieldKey(
        dependencies,
        reference.datasource,
        parseInstanceRef(`[${reference.instance}]`).base,
      );
    }
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== '[') continue;
      const segment = parseBracketSegment(value, index);
      if (!segment) continue;
      if (value.slice(segment.end, segment.end + 2) === '.[') {
        const second = parseBracketSegment(value, segment.end + 1);
        if (second) index = second.end - 1;
        continue;
      }
      addFieldKey(dependencies, defaultDatasource, segment.identifier);
      index = segment.end - 1;
    }
  }
  return [...dependencies.values()];
}

function dependencyFingerprint(workbookXml: string, worksheetXml: string): string {
  const workbook = parseXML(workbookXml);
  const datasourceByName = new Map<string, Record<string, any>>();
  for (const datasource of normalizeArray<Record<string, any>>(
    workbook.workbook?.datasources?.datasource,
  )) {
    const name = datasource['@_name'];
    if (typeof name === 'string' && name) datasourceByName.set(name, datasource);
  }
  const fallbackFields = listAvailableFields(workbookXml);
  const { keys, localCalculations } = collectIncomingFieldKeys(worksheetXml);
  const material = new Map<string, unknown>();
  const pending = [...keys.values()];
  while (pending.length > 0) {
    const key = pending.shift()!;
    const identity = `${key.datasource}\u0000${key.field}`;
    if (material.has(identity)) continue;
    const datasource = datasourceByName.get(key.datasource);
    const column = normalizeArray<Record<string, any>>(datasource?.column).find(
      (candidate) => normalizedFieldName(candidate['@_name'] ?? '') === key.field,
    );
    if (column) {
      material.set(identity, { datasource: key.datasource, field: key.field, definition: column });
      pending.push(...calculationDependencies(column.calculation, key.datasource));
      continue;
    }
    const fallback = fallbackFields.find(
      (candidate) =>
        candidate.datasource === key.datasource &&
        normalizedFieldName(candidate.columnName) === key.field,
    );
    if (fallback) {
      material.set(identity, {
        datasource: key.datasource,
        field: key.field,
        definition: {
          role: fallback.role,
          type: fallback.type,
          datatype: fallback.datatype,
          semanticRole: fallback.semanticRole,
          formula: fallback.formula,
          isGroup: fallback.isGroup,
        },
      });
      continue;
    }
    const localCalculation = localCalculations.get(identity);
    if (localCalculation !== undefined) {
      material.set(identity, { datasource: key.datasource, field: key.field, local: true });
      pending.push(...calculationDependencies(localCalculation, key.datasource));
      continue;
    }
    material.set(identity, {
      datasource: key.datasource,
      field: key.field,
      source: TABLEAU_IMPLICIT_GENERATED_FIELDS.has(key.field) ? 'generated' : 'missing',
    });
  }
  return sha256(
    stableStringify([...material.entries()].sort(([left], [right]) => left.localeCompare(right))),
  );
}

export function captureTargetWorksheetState(
  workbookXml: string,
  worksheetName: string,
  worksheetXml: string,
): TargetWorksheetState {
  return {
    worksheetName,
    target: worksheetState(workbookXml, worksheetName),
    targetWindow: windowState(workbookXml, worksheetName),
    dependenciesSha256: dependencyFingerprint(workbookXml, worksheetXml),
  };
}

export function compareTargetWorksheetState(
  expected: TargetWorksheetState,
  latestWorkbookXml: string,
  worksheetXml: string,
): TargetWorksheetStateComparison {
  const latest = captureTargetWorksheetState(
    latestWorkbookXml,
    expected.worksheetName,
    worksheetXml,
  );
  const reasons: TargetWorksheetDriftReason[] = [];
  if (stableStringify(latest.target) !== stableStringify(expected.target)) {
    reasons.push('target-worksheet-drift');
  }
  if (stableStringify(latest.targetWindow) !== stableStringify(expected.targetWindow)) {
    reasons.push('target-window-drift');
  }
  if (latest.dependenciesSha256 !== expected.dependenciesSha256) {
    reasons.push('datasource-drift');
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
