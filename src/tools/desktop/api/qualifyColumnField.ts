import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';
import {
  type ColumnFilterDatasource,
  qualifyDatasourceColumn,
} from '../../../desktop/wrappers/qualifyDatasourceColumn.js';

/**
 * The underlying-data column filter (`columnsToIncludeByFieldName`) matches only a
 * datasource-qualified field name — `[<datasource>].[<field>]`, e.g. `[federated.0abc123].[Region]`.
 * A bare `Region` is silently ignored (all columns come back), so the tool qualifies it here from
 * the worksheet's datasource. Desktop API 0.2.25 and later match the datasource internal name;
 * earlier builds match its caption.
 *
 * A value already in `[ds].[field]` form is passed through verbatim (power-user escape hatch).
 */
export function qualifyColumnFields(
  worksheetXml: string,
  columns: Array<string>,
  apiVersion: string | undefined,
): { ok: true; columns: Array<string> } | { ok: false; reason: string } {
  const datasources = worksheetDatasources(worksheetXml);

  const qualified: Array<string> = [];
  for (const raw of columns) {
    const column = raw.trim();
    if (isDatasourceQualified(column)) {
      qualified.push(column);
      continue;
    }
    if (datasources.length === 0) {
      return {
        ok: false,
        reason: 'the worksheet declares no datasource to qualify the field name against',
      };
    }
    if (datasources.length > 1) {
      const options = datasources
        .map((datasource) => qualifyDatasourceColumn(apiVersion, datasource, column))
        .join(', ');
      return {
        ok: false,
        reason: `the worksheet uses multiple datasources, so "${column}" is ambiguous — pass one of: ${options}`,
      };
    }
    qualified.push(qualifyDatasourceColumn(apiVersion, datasources[0], column));
  }
  return { ok: true, columns: qualified };
}

function worksheetDatasources(worksheetXml: string): Array<ColumnFilterDatasource> {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXML(worksheetXml) as unknown as Record<string, unknown>;
  } catch {
    return [];
  }
  const worksheet = findWorksheetNode(parsed);
  const view = ((worksheet?.['table'] as Record<string, unknown> | undefined)?.['view'] ??
    {}) as Record<string, unknown>;
  const container = (view['datasources'] ?? {}) as Record<string, unknown>;
  const datasources = new Map<string, ColumnFilterDatasource>();
  for (const ds of normalizeArray(
    container['datasource'] as Record<string, unknown> | Record<string, unknown>[] | undefined,
  )) {
    const internalName = ds['@_name'];
    if (typeof internalName !== 'string' || internalName.length === 0) {
      continue;
    }
    const caption = ds['@_caption'];
    datasources.set(internalName, {
      caption: typeof caption === 'string' && caption.length > 0 ? caption : internalName,
      internalName,
    });
  }
  return Array.from(datasources.values());
}

function findWorksheetNode(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const workbook = parsed['workbook'] as Record<string, unknown> | undefined;
  const wbWorksheets = workbook?.['worksheets'] as Record<string, unknown> | undefined;
  const candidate =
    normalizeArray(
      (wbWorksheets?.['worksheet'] ?? workbook?.['worksheet'] ?? parsed['worksheet']) as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | undefined,
    )[0] ?? undefined;
  return candidate;
}

function isDatasourceQualified(value: string): boolean {
  return /^\[[^\]]+\]\.\[.+\]$/.test(value);
}
