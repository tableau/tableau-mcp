import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';
import { qualifyDatasourceColumn } from '../../../desktop/wrappers/qualifyDatasourceColumn.js';

/**
 * The underlying-data column filter (`columnsToIncludeByFieldName`) matches only a
 * datasource-qualified field name — `[<datasource>].[<field>]`, e.g. `[federated.0abc123].[Region]`.
 * A bare `Region` is silently ignored (all columns come back), so the tool qualifies it here from
 * the worksheet's datasource.
 *
 * A value already in `[ds].[field]` form is passed through verbatim (power-user escape hatch).
 */
export function qualifyColumnFields(
  worksheetXml: string,
  columns: Array<string>,
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
        .map((datasource) => qualifyDatasourceColumn(datasource, column))
        .join(', ');
      return {
        ok: false,
        reason: `the worksheet uses multiple datasources, so "${column}" is ambiguous — pass one of: ${options}`,
      };
    }
    qualified.push(qualifyDatasourceColumn(datasources[0], column));
  }
  return { ok: true, columns: qualified };
}

function worksheetDatasources(worksheetXml: string): Array<string> {
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
  const datasources = new Set<string>();
  for (const ds of normalizeArray(
    container['datasource'] as Record<string, unknown> | Record<string, unknown>[] | undefined,
  )) {
    const internalName = ds['@_name'];
    if (typeof internalName !== 'string' || internalName.length === 0) {
      continue;
    }
    datasources.add(internalName);
  }
  return Array.from(datasources.values());
}

function findWorksheetNode(parsed: Record<string, unknown>): Record<string, unknown> | undefined {
  const workbook = parsed['workbook'] as Record<string, unknown> | undefined;
  const wbWorksheets = workbook?.['worksheets'] as Record<string, unknown> | undefined;
  const candidate =
    normalizeArray(
      (wbWorksheets?.['worksheet'] ?? workbook?.['worksheet'] ?? parsed['worksheet']) as
        Record<string, unknown> | Record<string, unknown>[] | undefined,
    )[0] ?? undefined;
  return candidate;
}

export function isDatasourceQualified(value: string): boolean {
  return /^\[[^\]]+\]\.\[.+\]$/.test(value);
}
