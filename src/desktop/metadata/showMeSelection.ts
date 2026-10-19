import { Err, Ok, Result } from 'ts-results-es';

import { ArgsValidationError } from '../../errors/mcpToolError.js';
import { listAvailableFields } from './field-builder.js';
import {
  parseColumnInstanceRef,
  parseDatasourceQualifiedColumnRef,
  resolveUniqueDatasourceName,
} from './field-resolver.js';
import { normalizeArray, parseXML } from './parser.js';

export type ShowMeSelection = {
  dataSource?: string;
  fieldsSelectedInSchemaViewer?: string[];
};

type AvailableField = ReturnType<typeof listAvailableFields>[number];

type DatasourceCandidate = { name: string; caption: string };

type ShowMeIdentityCatalog = {
  baseColumnsByDatasource: Map<string, Set<string>>;
  declaredInstancesByDatasource: Map<string, Set<string>>;
};

function addIdentity(
  identitiesByDatasource: Map<string, Set<string>>,
  datasource: unknown,
  identity: unknown,
): void {
  if (typeof datasource !== 'string' || typeof identity !== 'string') return;
  const identities = identitiesByDatasource.get(datasource) ?? new Set<string>();
  identities.add(identity);
  identitiesByDatasource.set(datasource, identities);
}

/**
 * Keeps the wire-level identity catalog separate from listAvailableFields(): that
 * projection deliberately hides fields from friendly-name discovery, while the
 * native Show Me API still accepts an already-canonical hidden identity.
 */
function showMeIdentityCatalog(workbookXml: string): ShowMeIdentityCatalog {
  const workbook = parseXML(workbookXml);
  const baseColumnsByDatasource = new Map<string, Set<string>>();
  const declaredInstancesByDatasource = new Map<string, Set<string>>();

  for (const datasource of normalizeArray(workbook.workbook?.datasources?.datasource)) {
    const record = datasource as Record<string, unknown>;
    for (const column of normalizeArray(record.column)) {
      addIdentity(
        baseColumnsByDatasource,
        record['@_name'],
        (column as Record<string, unknown>)['@_name'],
      );
    }
  }

  const visit = (node: unknown, currentDatasource: string | undefined): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, currentDatasource));
      return;
    }
    const record = node as Record<string, unknown>;
    const datasource =
      typeof record['@_datasource'] === 'string'
        ? record['@_datasource']
        : typeof record['@_name'] === 'string' && record['column-instance'] !== undefined
          ? record['@_name']
          : currentDatasource;
    for (const column of normalizeArray(record.column)) {
      addIdentity(
        baseColumnsByDatasource,
        datasource,
        (column as Record<string, unknown>)['@_name'],
      );
    }
    for (const instance of normalizeArray(record['column-instance'])) {
      addIdentity(
        declaredInstancesByDatasource,
        datasource,
        (instance as Record<string, unknown>)['@_name'],
      );
    }
    Object.entries(record)
      .filter(([key]) => !key.startsWith('@_') && key !== 'column' && key !== 'column-instance')
      .forEach(([, child]) => visit(child, datasource));
  };
  visit(workbook, undefined);

  return { baseColumnsByDatasource, declaredInstancesByDatasource };
}

function datasourceCandidateEntries(
  workbookXml: string,
  fields: AvailableField[],
): DatasourceCandidate[] {
  const captions = new Map<string, string>();
  for (const datasource of normalizeArray(
    parseXML(workbookXml).workbook?.datasources?.datasource,
  )) {
    const record = datasource as Record<string, unknown>;
    const name = record['@_name'];
    const caption = record['@_caption'];
    if (typeof name === 'string' && typeof caption === 'string') captions.set(name, caption);
  }
  return [...new Set(fields.map((field) => field.datasource))]
    .sort()
    .map((name) => ({ name, caption: captions.get(name) ?? name }));
}

function datasourceCandidates(
  workbookXml: string,
  fields: AvailableField[],
  requestedDatasource?: string,
): string[] {
  const candidates = datasourceCandidateEntries(workbookXml, fields);
  const normalizedRequested = requestedDatasource?.normalize('NFC');
  const matching =
    normalizedRequested === undefined
      ? candidates
      : candidates.filter(
          ({ name, caption }) =>
            name.normalize('NFC') === normalizedRequested ||
            caption.normalize('NFC') === normalizedRequested,
        );
  return (matching.length > 0 ? matching : candidates).map(
    ({ name, caption }) => `${caption} (${name})`,
  );
}

function datasourceError(
  input: string,
  workbookXml: string,
  fields: AvailableField[],
): ArgsValidationError {
  const available = datasourceCandidates(workbookXml, fields);
  return new ArgsValidationError(
    `dataSource "${input}" was not found or is ambiguous. Candidates: ${available.join(', ')}. Show Me was not called.`,
  );
}

function fieldError(
  input: string,
  index: number,
  reason: string,
  candidates: string[] = [],
): ArgsValidationError {
  const suggestions = candidates.length > 0 ? ` Candidates: ${candidates.join(', ')}.` : '';
  return new ArgsValidationError(
    `fieldsSelectedInSchemaViewer[${index}] "${input}" ${reason}.${suggestions} Show Me was not called.`,
  );
}

function fieldCandidates(fields: AvailableField[]): string[] {
  return fields.map((field) => `${field.caption ?? field.columnName} (${field.column_ref})`);
}

function normalizeFieldName(value: string): string {
  const normalized = value.normalize('NFC').trim();
  return normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized;
}

function baseColumnRef(field: AvailableField): string {
  return `[${field.datasource}].${field.columnName}`;
}

function matchingCaptions(fields: AvailableField[], input: string): AvailableField[] {
  const normalized = normalizeFieldName(input);
  return fields.filter(
    (field) =>
      normalizeFieldName(field.columnName) === normalized ||
      (field.caption !== undefined && normalizeFieldName(field.caption) === normalized),
  );
}

function canonicalField(
  fields: AvailableField[],
  input: string,
  datasource: string,
): AvailableField | undefined {
  return fields.find(
    (field) =>
      field.datasource === datasource &&
      (field.column_ref === input || baseColumnRef(field) === input),
  );
}

function canonicalIdentity(
  catalog: ShowMeIdentityCatalog,
  columnInstanceName: string,
  datasource: string,
): boolean {
  if (catalog.baseColumnsByDatasource.get(datasource)?.has(columnInstanceName)) return true;
  return (
    parseColumnInstanceRef(columnInstanceName) !== null &&
    catalog.declaredInstancesByDatasource.get(datasource)?.has(columnInstanceName) === true
  );
}

function derivedField(
  workbookXml: string,
  fields: AvailableField[],
  columnInstanceName: string,
  datasource: string,
): AvailableField | undefined {
  const instance = parseColumnInstanceRef(columnInstanceName);
  if (!instance) return undefined;
  const field = fields.find(
    (field) =>
      field.datasource === datasource && field.columnName === `[${instance.localFieldName}]`,
  );
  if (
    !field ||
    !hasDeclaredColumnInstance(workbookXml, datasource, field.columnName, columnInstanceName)
  ) {
    return undefined;
  }
  return field;
}

function hasDeclaredColumnInstance(
  workbookXml: string,
  datasource: string,
  column: string,
  instance: string,
): boolean {
  const visit = (node: unknown, currentDatasource: string | undefined): boolean => {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some((item) => visit(item, currentDatasource));
    const record = node as Record<string, unknown>;
    const datasourceName =
      typeof record['@_datasource'] === 'string'
        ? record['@_datasource']
        : typeof record['@_name'] === 'string' && record['column-instance'] !== undefined
          ? record['@_name']
          : currentDatasource;
    for (const columnInstance of normalizeArray(record['column-instance'])) {
      const candidate = columnInstance as Record<string, unknown>;
      if (
        datasourceName === datasource &&
        candidate['@_column'] === column &&
        candidate['@_name'] === instance
      ) {
        return true;
      }
    }
    return Object.entries(record)
      .filter(([key]) => !key.startsWith('@_') && key !== 'column-instance')
      .some(([, child]) => visit(child, datasourceName));
  };
  return visit(parseXML(workbookXml), undefined);
}

/**
 * Resolves Show Me's user-facing field inputs to the strict External Client API
 * column references without changing the shared resolver's global semantics.
 * It intentionally does not fuzzy-match a requested field.
 */
export function resolveShowMeSelection(
  workbookXml: string,
  selection: ShowMeSelection,
): Result<ShowMeSelection, ArgsValidationError> {
  const availableFields = listAvailableFields(workbookXml);
  const identityCatalog = showMeIdentityCatalog(workbookXml);
  const resolvedDataSourceResult =
    selection.dataSource === undefined
      ? undefined
      : resolveUniqueDatasourceName(workbookXml, selection.dataSource);

  if (selection.dataSource !== undefined && resolvedDataSourceResult === null) {
    return datasourceError(selection.dataSource, workbookXml, availableFields).toErr();
  }
  const resolvedDataSource = resolvedDataSourceResult ?? undefined;

  if (selection.fieldsSelectedInSchemaViewer === undefined) {
    return new Ok(resolvedDataSource === undefined ? {} : { dataSource: resolvedDataSource });
  }

  const resolvedFields: string[] = [];
  for (const [index, input] of selection.fieldsSelectedInSchemaViewer.entries()) {
    const qualified = parseDatasourceQualifiedColumnRef(input);
    let fieldInput = input;
    let fieldDatasource = resolvedDataSource;
    let qualifierIsInternal = false;
    if (qualified) {
      const qualifiedDatasource = resolveUniqueDatasourceName(workbookXml, qualified.datasource);
      if (qualifiedDatasource === null) {
        return fieldError(
          input,
          index,
          `uses datasource "${qualified.datasource}" that was not found or is ambiguous`,
          datasourceCandidates(workbookXml, availableFields, qualified.datasource),
        ).toErr();
      }
      if (fieldDatasource !== undefined && fieldDatasource !== qualifiedDatasource) {
        return new Err(
          fieldError(input, index, `conflicts with dataSource "${selection.dataSource}"`),
        );
      }
      fieldDatasource = qualifiedDatasource;
      fieldInput = qualified.columnInstanceName;
      qualifierIsInternal = qualified.datasource === qualifiedDatasource;

      const canonical =
        canonicalField(availableFields, input, qualifiedDatasource) !== undefined ||
        canonicalIdentity(identityCatalog, fieldInput, qualifiedDatasource);
      const derived = derivedField(workbookXml, availableFields, fieldInput, qualifiedDatasource);
      if (canonical || derived) {
        resolvedFields.push(
          qualifierIsInternal ? input : `[${qualifiedDatasource}].${qualified.columnInstanceName}`,
        );
        continue;
      }
    }

    const scopedFields = availableFields.filter(
      (field) => fieldDatasource === undefined || field.datasource === fieldDatasource,
    );
    const captionMatches = matchingCaptions(scopedFields, fieldInput);
    if (captionMatches.length === 1) {
      resolvedFields.push(baseColumnRef(captionMatches[0]));
      continue;
    }
    if (captionMatches.length > 1) {
      return fieldError(input, index, 'is ambiguous', fieldCandidates(captionMatches)).toErr();
    }
    return fieldError(
      input,
      index,
      fieldDatasource === undefined
        ? 'was not found'
        : `was not found in datasource "${fieldDatasource}"`,
      fieldCandidates(scopedFields.slice(0, 5)),
    ).toErr();
  }

  return new Ok({
    ...(resolvedDataSource === undefined ? {} : { dataSource: resolvedDataSource }),
    fieldsSelectedInSchemaViewer: resolvedFields,
  });
}
