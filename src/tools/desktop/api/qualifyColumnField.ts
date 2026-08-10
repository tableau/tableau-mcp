import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';

/**
 * The underlying-data column filter (`columnsToIncludeByFieldName`) matches only a
 * datasource-qualified field name — `[<datasource caption>].[<field>]`, e.g.
 * `[Sample - Superstore].[Region]`. A bare `Region` is silently ignored (all columns come back),
 * so the tool qualifies it here from the worksheet's datasource caption.
 *
 * A value already in `[ds].[field]` form is passed through verbatim (power-user escape hatch).
 */
export function qualifyColumnFields(
  worksheetXml: string,
  columns: Array<string>,
): { ok: true; columns: Array<string> } | { ok: false; reason: string } {
  const captions = worksheetDatasourceCaptions(worksheetXml);

  const qualified: Array<string> = [];
  for (const raw of columns) {
    const column = raw.trim();
    if (isDatasourceQualified(column)) {
      qualified.push(column);
      continue;
    }
    if (captions.length === 0) {
      return {
        ok: false,
        reason: 'the worksheet declares no datasource to qualify the field name against',
      };
    }
    if (captions.length > 1) {
      return {
        ok: false,
        reason:
          `the worksheet uses multiple datasources (${captions.join(', ')}), so "${column}" is ambiguous — ` +
          'pass the field as [datasource].[field]',
      };
    }
    qualified.push(`[${captions[0]}].[${stripBrackets(column)}]`);
  }
  return { ok: true, columns: qualified };
}

/** Datasource captions declared on a worksheet, preferring `@_caption` over the internal `@_name`. */
function worksheetDatasourceCaptions(worksheetXml: string): Array<string> {
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
  const datasources = normalizeArray(
    container['datasource'] as Record<string, unknown> | Record<string, unknown>[] | undefined,
  );
  const captions = datasources
    .map((ds) => (ds['@_caption'] ?? ds['@_name']) as string | undefined)
    .filter((caption): caption is string => typeof caption === 'string' && caption.length > 0);
  return Array.from(new Set(captions));
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

function stripBrackets(value: string): string {
  return value.replace(/^\[/, '').replace(/\]$/, '');
}
