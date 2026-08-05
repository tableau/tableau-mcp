import { createHash } from 'node:crypto';

import { z } from 'zod';

import { parseInstanceRef } from '../templates/bookmarkTemplate.js';
import { xmlNamesEqual } from '../xmlElement.js';
import { listAvailableFields } from './field-builder.js';
import { carryNamespaceDeclarations, findWorksheet, normalizeArray, parseXML } from './parser.js';
import type { ParsedWindow } from './types.js';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const targetWorksheetStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('absent') }).strict(),
  z.object({ state: z.literal('present'), sha256: sha256Schema }).strict(),
]);

export const worksheetApplyStateSchema = z
  .object({
    target: targetWorksheetStateSchema,
    targetWindow: targetWorksheetStateSchema,
    dependenciesSha256: sha256Schema,
    artifactSha256: sha256Schema,
  })
  .strict();

export type TargetWorksheetState = z.infer<typeof targetWorksheetStateSchema>;
export type WorksheetApplyState = z.infer<typeof worksheetApplyStateSchema>;

interface QualifiedReference {
  datasource: string;
  fieldOrInstance: string;
}

interface FieldKey {
  datasource: string;
  field: string;
}

interface InstanceIdentity {
  field: string;
  derivation: string;
  role: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
  return JSON.stringify(sort(value));
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
    const colonIndex = xmlName.indexOf(':');
    if (colonIndex > 0) prefixes.add(xmlName.slice(0, colonIndex));
    collectUsedNamespacePrefixes(child, prefixes);
  }
}

function relevantNamespaces(
  ancestor: Record<string, unknown> | undefined,
  usedPrefixes: Set<string>,
): Record<string, unknown> {
  const namespaces: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ancestor ?? {})) {
    if (key === '@_xmlns' || (key.startsWith('@_xmlns:') && usedPrefixes.has(key.slice(8)))) {
      namespaces[key] = value;
    }
  }
  return namespaces;
}

function removeNamespaceDeclarations(element: Record<string, unknown>): void {
  for (const key of Object.keys(element)) {
    if (key === '@_xmlns' || key.startsWith('@_xmlns:')) delete element[key];
  }
}

function removeInsignificantXmlWhitespace(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeInsignificantXmlWhitespace);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, child]) => !(key === '#text' && typeof child === 'string' && child.trim() === ''),
      )
      .map(([key, child]) => [key, removeInsignificantXmlWhitespace(child)]),
  );
}

function extractFingerprintWorksheetXml(workbookXml: string, worksheetName: string): string | null {
  const workbook = parseXML(workbookXml);
  const worksheet = findWorksheet(workbook, worksheetName);
  if (!worksheet) return null;

  const usedPrefixes = new Set<string>();
  collectUsedNamespacePrefixes(worksheet, usedPrefixes);

  const rootNamespaces = relevantNamespaces(workbook.workbook, usedPrefixes);
  const worksheetsNamespaces = relevantNamespaces(workbook.workbook?.worksheets, usedPrefixes);
  const ancestorNamespaces = { ...rootNamespaces, ...worksheetsNamespaces };
  carryNamespaceDeclarations(ancestorNamespaces, worksheet);

  return stableStringify(removeInsignificantXmlWhitespace(worksheet));
}

export function deriveTargetWorksheetState(
  workbookXml: string,
  worksheetName: string,
): TargetWorksheetState {
  const worksheetXml = extractFingerprintWorksheetXml(workbookXml, worksheetName);
  if (worksheetXml === null) return { state: 'absent' };
  return { state: 'present', sha256: sha256(worksheetXml) };
}

function isTargetWorksheetWindow(window: ParsedWindow, worksheetName: string): boolean {
  return (
    xmlNamesEqual(window['@_name'], worksheetName) &&
    (window['@_class'] === undefined ||
      window['@_class'] === '' ||
      window['@_class'] === 'worksheet')
  );
}

function extractFingerprintWindowXml(workbookXml: string, worksheetName: string): string | null {
  const workbook = parseXML(workbookXml);
  const windows = normalizeArray<ParsedWindow>(workbook.workbook?.windows?.window).filter(
    (candidate) => isTargetWorksheetWindow(candidate, worksheetName),
  );
  if (windows.length === 0) return null;

  return stableStringify(
    windows.map((window) => {
      const fingerprintWindow = { ...window };
      delete fingerprintWindow['@_active'];
      delete fingerprintWindow['@_maximized'];
      delete fingerprintWindow['simple-id'];
      const usedPrefixes = new Set<string>();
      collectUsedNamespacePrefixes(fingerprintWindow, usedPrefixes);
      const localNamespaces = relevantNamespaces(fingerprintWindow, usedPrefixes);
      // Reinsert can leave unused declarations on the window; rebuild only its semantic namespace context.
      removeNamespaceDeclarations(fingerprintWindow);
      const rootNamespaces = relevantNamespaces(workbook.workbook, usedPrefixes);
      const windowsNamespaces = relevantNamespaces(workbook.workbook?.windows, usedPrefixes);
      carryNamespaceDeclarations(
        { ...rootNamespaces, ...windowsNamespaces, ...localNamespaces },
        fingerprintWindow,
      );
      return removeInsignificantXmlWhitespace(fingerprintWindow);
    }),
  );
}

export function deriveTargetWorksheetWindowState(
  workbookXml: string,
  worksheetName: string,
): TargetWorksheetState {
  const windowXml = extractFingerprintWindowXml(workbookXml, worksheetName);
  if (windowXml === null) return { state: 'absent' };
  return { state: 'present', sha256: sha256(windowXml) };
}

export function deriveWorksheetArtifactSha256(
  worksheetXml: string,
  worksheetWindowXml?: string,
): string {
  return sha256(
    stableStringify({
      worksheetXml: worksheetXml.trim(),
      worksheetWindowXml: worksheetWindowXml?.trim() ?? null,
    }),
  );
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
      index++;
      continue;
    }
    return { identifier, end: index + 1 };
  }
  return null;
}

function qualifiedReferences(value: string): QualifiedReference[] {
  const references: QualifiedReference[] = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '[') continue;
    const datasource = parseBracketSegment(value, index);
    if (!datasource || value.slice(datasource.end, datasource.end + 2) !== '.[') continue;
    const field = parseBracketSegment(value, datasource.end + 1);
    if (!field) {
      throw new Error(`Malformed datasource-qualified field reference near ${value.slice(index)}`);
    }
    references.push({ datasource: datasource.identifier, fieldOrInstance: field.identifier });
    index = field.end - 1;
  }
  return references;
}

function collectReferenceStringValues(value: unknown, strings: string[]): void {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceStringValues(item, strings);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'datasource-dependencies') collectReferenceStringValues(child, strings);
    }
  }
}

function normalizedFieldName(value: string): string {
  const segment = parseBracketSegment(value, 0);
  if (segment && segment.end === value.length) return segment.identifier;
  return value;
}

function instanceIdentity(instance: string): InstanceIdentity | null {
  const parts = instance.split(':');
  if (parts.length < 3) return null;
  let roleIndex = -1;
  for (let index = parts.length - 1; index >= 0; index--) {
    if (parts[index] === 'nk' || parts[index] === 'ok' || parts[index] === 'qk') {
      roleIndex = index;
      break;
    }
  }
  if (roleIndex !== parts.length - 1 || roleIndex < 2) return null;
  const parsed = parseInstanceRef(`[${instance}]`);
  if (!parsed.base) return null;
  return { field: parsed.base, derivation: parsed.derivation, role: parts[roleIndex] };
}

function fieldFromInstance(instance: string): string | null {
  return instanceIdentity(instance)?.field ?? null;
}

function instancesShareBindingIdentity(left: string, right: string): boolean {
  const leftIdentity = instanceIdentity(left);
  const rightIdentity = instanceIdentity(right);
  return (
    leftIdentity !== null &&
    rightIdentity !== null &&
    leftIdentity.field === rightIdentity.field &&
    leftIdentity.derivation === rightIdentity.derivation &&
    leftIdentity.role === rightIdentity.role
  );
}

function dependencyBlocks(worksheet: Record<string, any>): Array<Record<string, any>> {
  return normalizeArray(worksheet.table?.view?.['datasource-dependencies']);
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
  if (!worksheet) throw new Error('Expected a standalone worksheet XML fragment');

  const blocksByDatasource = new Map<string, Record<string, any>>();
  const localCalculations = new Map<string, unknown>();
  const keys = new Map<string, FieldKey>();

  for (const block of dependencyBlocks(worksheet)) {
    const datasource = block['@_datasource'];
    if (typeof datasource !== 'string' || !datasource) {
      throw new Error('A datasource-dependencies block has no datasource identity');
    }
    if (blocksByDatasource.has(datasource)) {
      throw new Error(`Duplicate datasource-dependencies blocks for ${datasource}`);
    }
    blocksByDatasource.set(datasource, block);
    for (const column of normalizeArray<Record<string, any>>(block.column)) {
      const rawName = column['@_name'];
      if (typeof rawName !== 'string' || !rawName) continue;
      const field = normalizedFieldName(rawName);
      if (column.calculation !== undefined) {
        localCalculations.set(`${datasource}\u0000${field}`, column.calculation);
      }
    }
  }

  const strings: string[] = [];
  collectReferenceStringValues(worksheet, strings);
  const references = strings.flatMap(qualifiedReferences);
  for (const reference of references) {
    const block = blocksByDatasource.get(reference.datasource);
    const declaredInstances = normalizeArray<Record<string, any>>(block?.['column-instance']);
    const declaration = declaredInstances.find((candidate) => {
      const candidateName = normalizedFieldName(candidate['@_name'] ?? '');
      return (
        candidateName === reference.fieldOrInstance ||
        instancesShareBindingIdentity(candidateName, reference.fieldOrInstance)
      );
    });

    let field: string | null = null;
    if (declaration) {
      const declaredColumn = declaration['@_column'];
      if (typeof declaredColumn !== 'string' || !declaredColumn) {
        throw new Error(
          `Column instance [${reference.fieldOrInstance}] has no column in datasource ${reference.datasource}`,
        );
      }
      field = normalizedFieldName(declaredColumn);
    } else if (block) {
      const isDirectColumn = normalizeArray<Record<string, any>>(block.column).some(
        (candidate) => normalizedFieldName(candidate['@_name'] ?? '') === reference.fieldOrInstance,
      );
      if (isDirectColumn) field = reference.fieldOrInstance;
      else {
        throw new Error(
          `Referenced field instance [${reference.datasource}].[${reference.fieldOrInstance}] has no matching declaration`,
        );
      }
    } else {
      field = fieldFromInstance(reference.fieldOrInstance) ?? reference.fieldOrInstance;
    }
    addFieldKey(keys, reference.datasource, field);
  }

  for (const value of strings) {
    for (const reference of unqualifiedBracketReferences(value)) {
      const instanceMatches = [...blocksByDatasource.entries()].flatMap(([datasource, block]) =>
        normalizeArray<Record<string, any>>(block['column-instance'])
          .filter((candidate) => {
            const candidateName = normalizedFieldName(candidate['@_name'] ?? '');
            return (
              candidateName === reference || instancesShareBindingIdentity(candidateName, reference)
            );
          })
          .map((candidate) => ({ datasource, column: candidate['@_column'] })),
      );
      const directMatches = [...blocksByDatasource.entries()].flatMap(([datasource, block]) =>
        normalizeArray<Record<string, any>>(block.column)
          .filter((candidate) => normalizedFieldName(candidate['@_name'] ?? '') === reference)
          .map(() => ({ datasource, column: reference })),
      );
      const matches = instanceMatches.length > 0 ? instanceMatches : directMatches;
      if (matches.length === 0 && fieldFromInstance(reference) === null) continue;
      if (matches.length !== 1) {
        throw new Error(
          `Unqualified field reference [${reference}] does not resolve to exactly one datasource declaration`,
        );
      }
      const column = matches[0].column;
      if (typeof column !== 'string' || !column) {
        throw new Error(`Column instance [${reference}] has no column declaration`);
      }
      addFieldKey(keys, matches[0].datasource, normalizedFieldName(column));
    }
  }

  return { keys, localCalculations };
}

function unqualifiedBracketReferences(value: string): string[] {
  const references: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '[') continue;
    const first = parseBracketSegment(value, index);
    if (!first) continue;
    if (value.slice(first.end, first.end + 2) === '.[') {
      const second = parseBracketSegment(value, first.end + 1);
      if (!second) throw new Error(`Malformed datasource-qualified field reference near ${value}`);
      index = second.end - 1;
      continue;
    }
    references.push(first.identifier);
    index = first.end - 1;
  }
  return references;
}

function calculationDependencies(calculation: unknown, defaultDatasource: string): FieldKey[] {
  if (calculation === null || typeof calculation !== 'object') return [];
  const values: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (
        (key === '@_formula' || key === '@_column' || key === '@_expression') &&
        typeof child === 'string'
      ) {
        values.push(child);
      } else {
        visit(child);
      }
    }
  };
  visit(calculation);

  const dependencies = new Map<string, FieldKey>();
  for (const value of values) {
    for (const reference of qualifiedReferences(value)) {
      const field = fieldFromInstance(reference.fieldOrInstance) ?? reference.fieldOrInstance;
      addFieldKey(dependencies, reference.datasource, field);
    }
    for (let index = 0; index < value.length; index++) {
      if (value[index] !== '[') continue;
      const first = parseBracketSegment(value, index);
      if (!first) throw new Error(`Malformed field reference in calculation: ${value}`);
      if (value.slice(first.end, first.end + 2) === '.[') {
        const second = parseBracketSegment(value, first.end + 1);
        if (!second) throw new Error(`Malformed field reference in calculation: ${value}`);
        index = second.end - 1;
        continue;
      }
      addFieldKey(dependencies, defaultDatasource, first.identifier);
      index = first.end - 1;
    }
  }
  return [...dependencies.values()];
}

function dependencyFingerprint(workbookXml: string, worksheetXml: string): string {
  const workbook = parseXML(workbookXml);
  const datasources = normalizeArray<Record<string, any>>(
    workbook.workbook?.datasources?.datasource,
  );
  const datasourceByName = new Map<string, Record<string, any>>();
  for (const datasource of datasources) {
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
    const topLevelColumn = normalizeArray<Record<string, any>>(datasource?.column).find(
      (column) => normalizedFieldName(column['@_name'] ?? '') === key.field,
    );
    if (topLevelColumn) {
      material.set(identity, {
        datasource: key.datasource,
        field: key.field,
        source: 'top-level',
        definition: topLevelColumn,
      });
      pending.push(...calculationDependencies(topLevelColumn.calculation, key.datasource));
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
        source: 'physical',
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
      material.set(identity, {
        datasource: key.datasource,
        field: key.field,
        source: 'template-local-absent',
      });
      pending.push(...calculationDependencies(localCalculation, key.datasource));
      continue;
    }

    material.set(identity, {
      datasource: key.datasource,
      field: key.field,
      source: 'missing',
    });
  }

  return sha256(
    stableStringify([...material.entries()].sort(([left], [right]) => left.localeCompare(right))),
  );
}

export function deriveWorksheetApplyState(
  workbookXml: string,
  worksheetName: string,
  worksheetXml: string,
  worksheetWindowXml?: string,
): WorksheetApplyState {
  return {
    target: deriveTargetWorksheetState(workbookXml, worksheetName),
    targetWindow: deriveTargetWorksheetWindowState(workbookXml, worksheetName),
    dependenciesSha256: dependencyFingerprint(workbookXml, worksheetXml),
    artifactSha256: deriveWorksheetArtifactSha256(worksheetXml, worksheetWindowXml),
  };
}
