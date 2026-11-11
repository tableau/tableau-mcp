import { Err, Ok, Result } from 'ts-results-es';

import { ArgsValidationError } from '../../errors/mcpToolError.js';
import { listAvailableFieldsFromWorkbook } from './field-builder.js';
import {
  parseColumnInstanceRef,
  parseDatasourceQualifiedColumnRef,
  resolveUniqueDatasourceNameFromWorkbook,
} from './field-resolver.js';
import { normalizeArray, parseXML } from './parser.js';
import type { ParsedWorkbook } from './types.js';

export type ShowMeSelection = {
  dataSource?: string;
  fieldsSelectedInSchemaViewer?: string[];
};

type AvailableField = ReturnType<typeof listAvailableFieldsFromWorkbook>[number];

type DatasourceCandidate = { name: string; caption: string };

type ShowMeIdentityCatalog = {
  baseColumnsByDatasource: Map<string, Set<string>>;
  declaredColumnsByInstanceByDatasource: Map<string, Map<string, string>>;
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

function addDeclaredInstance(
  instancesByDatasource: Map<string, Map<string, string>>,
  datasource: unknown,
  instance: unknown,
  column: unknown,
): void {
  if (
    typeof datasource !== 'string' ||
    typeof instance !== 'string' ||
    typeof column !== 'string'
  ) {
    return;
  }
  const instances = instancesByDatasource.get(datasource) ?? new Map<string, string>();
  instances.set(instance, column);
  instancesByDatasource.set(datasource, instances);
}

/**
 * Keeps the wire-level identity catalog separate from listAvailableFields(): that
 * projection deliberately hides fields from friendly-name discovery, while the
 * native Show Me API still accepts an already-canonical hidden identity.
 */
function showMeIdentityCatalog(workbook: ParsedWorkbook): ShowMeIdentityCatalog {
  const baseColumnsByDatasource = new Map<string, Set<string>>();
  const declaredColumnsByInstanceByDatasource = new Map<string, Map<string, string>>();

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
      const candidate = instance as Record<string, unknown>;
      addDeclaredInstance(
        declaredColumnsByInstanceByDatasource,
        datasource,
        candidate['@_name'],
        candidate['@_column'],
      );
    }
    Object.entries(record)
      .filter(([key]) => !key.startsWith('@_') && key !== 'column' && key !== 'column-instance')
      .forEach(([, child]) => visit(child, datasource));
  };
  visit(workbook, undefined);

  return { baseColumnsByDatasource, declaredColumnsByInstanceByDatasource };
}

function datasourceCandidateEntries(
  workbook: ParsedWorkbook,
  fields: AvailableField[],
): DatasourceCandidate[] {
  const captions = new Map<string, string>();
  for (const datasource of normalizeArray(workbook.workbook?.datasources?.datasource)) {
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
  workbook: ParsedWorkbook,
  fields: AvailableField[],
  requestedDatasource?: string,
): string[] {
  const candidates = datasourceCandidateEntries(workbook, fields);
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
  workbook: ParsedWorkbook,
  fields: AvailableField[],
): ArgsValidationError {
  const available = datasourceCandidates(workbook, fields);
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
    catalog.declaredColumnsByInstanceByDatasource.get(datasource)?.has(columnInstanceName) === true
  );
}

function derivedField(
  catalog: ShowMeIdentityCatalog,
  fields: AvailableField[],
  columnInstanceName: string,
  datasource: string,
): AvailableField | undefined {
  const instance = parseColumnInstanceRef(columnInstanceName);
  if (!instance) return undefined;
  const declaredColumn = catalog.declaredColumnsByInstanceByDatasource
    .get(datasource)
    ?.get(columnInstanceName);
  if (declaredColumn !== `[${instance.localFieldName}]`) {
    return undefined;
  }
  return fields.find(
    (field) => field.datasource === datasource && field.columnName === declaredColumn,
  );
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
  const workbook = parseXML(workbookXml);
  const availableFields = listAvailableFieldsFromWorkbook(workbook);
  const identityCatalog = showMeIdentityCatalog(workbook);
  const resolvedDataSourceResult =
    selection.dataSource === undefined
      ? undefined
      : resolveUniqueDatasourceNameFromWorkbook(workbook, selection.dataSource);

  if (selection.dataSource !== undefined && resolvedDataSourceResult === null) {
    return datasourceError(selection.dataSource, workbook, availableFields).toErr();
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
      const qualifiedDatasource = resolveUniqueDatasourceNameFromWorkbook(
        workbook,
        qualified.datasource,
      );
      if (qualifiedDatasource === null) {
        return fieldError(
          input,
          index,
          `uses datasource "${qualified.datasource}" that was not found or is ambiguous`,
          datasourceCandidates(workbook, availableFields, qualified.datasource),
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
      const derived = derivedField(
        identityCatalog,
        availableFields,
        fieldInput,
        qualifiedDatasource,
      );
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
