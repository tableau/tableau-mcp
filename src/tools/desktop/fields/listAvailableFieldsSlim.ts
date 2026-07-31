import { Ok, Result } from 'ts-results-es';

import { DatasourceItem } from '../../../desktop/externalApi/types.js';
import { listAvailableFields } from '../../../desktop/metadata/index.js';
import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';

type MeasureCandidate = [
  caption: string,
  localName: string,
  aggregation: string,
  fieldKind: 'base' | 'aggregatedCalc',
];
type TimeDimensionCandidate = [caption: string, localName: string, dateType: 'date' | 'datetime'];
type BreakdownDimensionCandidate = [
  caption: string,
  localName: string,
  categoryType: 'nominal' | 'ordinal',
];

interface DatasourceFieldCandidateGroup {
  datasource: string;
  name?: string;
  luid?: string;
  measures: MeasureCandidate[];
  timeDimensions: TimeDimensionCandidate[];
  breakdownDimensions: BreakdownDimensionCandidate[];
}

export interface ListAvailableFieldsSlimResult {
  datasources: DatasourceFieldCandidateGroup[];
}

function isNumericDatatype(datatype?: string): boolean {
  return datatype === 'integer' || datatype === 'real' || datatype === 'number';
}

function isDateDatatype(datatype?: string): datatype is 'date' | 'datetime' {
  return datatype === 'date' || datatype === 'datetime';
}

function isCategoryType(type: string): type is 'nominal' | 'ordinal' {
  return type === 'nominal' || type === 'ordinal';
}

/** Project the verbose workbook field model into compact datasource groups. */
export function projectListAvailableFieldsSlim(
  fields: ReturnType<typeof listAvailableFields>,
): ListAvailableFieldsSlimResult {
  const groups = new Map<string, DatasourceFieldCandidateGroup>();

  for (const field of fields) {
    let group = groups.get(field.datasource);
    if (!group) {
      group = {
        datasource: field.datasource,
        measures: [],
        timeDimensions: [],
        breakdownDimensions: [],
      };
      groups.set(field.datasource, group);
    }

    const localName = field.columnName.replace(/^\[|\]$/g, '');
    const caption = field.caption || localName;

    if (field.role === 'measure' && isNumericDatatype(field.datatype)) {
      group.measures.push([
        caption,
        localName,
        field.isAggregated ? 'User' : field.derivation,
        field.isAggregated ? 'aggregatedCalc' : 'base',
      ]);
      continue;
    }

    if (field.role !== 'dimension') continue;

    if (isDateDatatype(field.datatype)) {
      group.timeDimensions.push([caption, localName, field.datatype]);
      continue;
    }

    if (isCategoryType(field.type)) {
      group.breakdownDimensions.push([caption, localName, field.type]);
    }
  }

  return { datasources: Array.from(groups.values()) };
}

export function filterListAvailableFieldsSlimByLuid({
  result,
  workbookDatasources,
  luids,
}: {
  result: ListAvailableFieldsSlimResult;
  workbookDatasources: DatasourceItem[];
  luids: string[];
}): Result<ListAvailableFieldsSlimResult, McpToolError> {
  const requestedLuids = new Set(luids);
  const datasources: DatasourceFieldCandidateGroup[] = [];
  let matchedWorkbookIdentity = false;

  for (const group of result.datasources) {
    // Workbook fields carry the datasource's internal name, which the API exposes as `id`
    // for modern federated datasources. Friendly name/caption matching is the legacy fallback.
    const idMatches = workbookDatasources.filter(
      (datasource) => datasource.id === group.datasource,
    );
    const matchingDatasources =
      idMatches.length > 0
        ? idMatches
        : workbookDatasources.filter(
            (datasource) =>
              datasource.name === group.datasource || datasource.caption === group.datasource,
          );
    if (matchingDatasources.length > 0) matchedWorkbookIdentity = true;
    const luidBackedMatches = matchingDatasources.filter(
      (datasource): datasource is DatasourceItem & { luid: string } =>
        typeof datasource.luid === 'string' && datasource.luid.length > 0,
    );

    if (luidBackedMatches.length === 0) continue;
    if (
      requestedLuids.size > 0 &&
      !luidBackedMatches.some((datasource) => requestedLuids.has(datasource.luid))
    ) {
      continue;
    }

    if (matchingDatasources.length > 1) {
      const identities = matchingDatasources.map((datasource) =>
        typeof datasource.luid === 'string' ? datasource.luid : '<no LUID>',
      );
      return new ArgsValidationError(
        `Datasource "${group.datasource}" matched multiple workbook datasources: ${identities.join(', ')}.`,
      ).toErr();
    }

    const luid = luidBackedMatches[0].luid;
    const name = luidBackedMatches[0].caption ?? luidBackedMatches[0].name ?? group.datasource;
    datasources.push({ ...group, name, luid });
  }

  if (
    requestedLuids.size === 0 &&
    result.datasources.length > 0 &&
    workbookDatasources.length > 0 &&
    !matchedWorkbookIdentity
  ) {
    const fieldIdentities = result.datasources.map(({ datasource }) => datasource);
    const workbookIdentities = workbookDatasources.flatMap(({ id, name, caption }) =>
      [id, name, caption].filter((identity): identity is string => Boolean(identity)),
    );
    return new ArgsValidationError(
      `Could not match workbook field datasource identities (${fieldIdentities.join(', ')}) to workbook datasource metadata (${workbookIdentities.join(', ')}).`,
    ).toErr();
  }

  if (requestedLuids.size > 0) {
    const matchedLuids = new Set(datasources.map((datasource) => datasource.luid));
    const unmatchedLuids = luids.filter((luid) => !matchedLuids.has(luid));
    if (unmatchedLuids.length > 0) {
      const matched = [...matchedLuids].filter((luid): luid is string => luid !== undefined);
      return new ArgsValidationError(
        [
          `No workbook datasource fields matched LUIDs: ${unmatchedLuids.join(', ')}.`,
          matched.length > 0 ? `Matched LUIDs: ${matched.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      ).toErr();
    }
  }

  return new Ok({ datasources });
}
