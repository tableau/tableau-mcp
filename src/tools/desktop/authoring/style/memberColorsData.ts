import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/externalApiToolExecutor.js';
import { normalizeArray, parseXML } from '../../../../desktop/metadata/parser.js';
import { DesktopCommandExecutionError } from '../../../../errors/mcpToolError.desktop.js';
import { UnknownError } from '../../../../errors/mcpToolError.js';
import { fetchWorksheetSummaryData, type SummaryDataRead } from '../../api/summaryDataCore.js';
import type { ColorTarget } from './memberColorsTarget.js';

export const NULL_TOKEN = /^%.*%$/;
export const DATA_MAX_ROWS = 10000;
const DATA_READ_TIMEOUT_MS = 5000;

export type DataMembers = {
  values: string[];
  /** False when the read hit the row cap, so absent members may still exist. */
  complete: boolean;
};

/** Distinct string values of the target's column in the sheet's summary data, or undefined. */
export async function readDataMembers({
  executor,
  worksheetName,
  target,
  signal: callSignal,
}: {
  executor: ExternalApiToolExecutor;
  worksheetName: string;
  target: ColorTarget;
  signal: AbortSignal;
}): Promise<DataMembers | undefined> {
  const signal = AbortSignal.any([callSignal, AbortSignal.timeout(DATA_READ_TIMEOUT_MS)]);
  const read: SummaryDataRead = async (_endpoint, readEndpoint) => {
    try {
      const result = await readEndpoint(executor, signal);
      return result.isErr() ? new DesktopCommandExecutionError(result.error).toErr() : result;
    } catch (error) {
      return new UnknownError(error instanceof Error ? error.message : String(error)).toErr();
    }
  };
  const summary = await fetchWorksheetSummaryData({
    read,
    worksheet: worksheetName,
    maxRows: DATA_MAX_ROWS,
    materializeEmpty: true,
    ignoreAliases: true,
  });
  if (summary.isErr()) return undefined;

  const wanted = new Set([target.label, `AGG(${target.label})`, `ATTR(${target.label})`]);
  const matches = summary.value.columns.flatMap((column, index) =>
    typeof column === 'object' &&
    column !== null &&
    wanted.has((column as { name?: string }).name ?? '')
      ? [{ index, dataType: (column as { dataType?: unknown }).dataType }]
      : [],
  );
  if (matches.length !== 1) return undefined;
  const { index, dataType } = matches[0];
  // Live Desktop sends "cstring" for text columns and "real" for measures.
  if (typeof dataType === 'string' && !dataType.toLowerCase().endsWith('string')) return undefined;

  const values = new Set<string>();
  for (const row of summary.value.rows) {
    const cell = row[index];
    if (typeof cell === 'string' && cell.trim().length > 0 && !NULL_TOKEN.test(cell)) {
      values.add(cell);
    }
  }
  return values.size === 0
    ? undefined
    : { values: [...values], complete: summary.value.rows.length < DATA_MAX_ROWS };
}

/** Alias display value -> raw members, from the datasource column's `<aliases>`. */
export function readAliases(datasourceXml: string, column: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  try {
    const root = parseXML(datasourceXml) as Record<string, any>;
    for (const datasource of normalizeArray(root.datasource)) {
      for (const candidate of normalizeArray(datasource?.column)) {
        if (candidate?.['@_name'] !== column) continue;
        for (const alias of normalizeArray(candidate.aliases?.alias)) {
          const key = alias?.['@_key'];
          const value = alias?.['@_value'];
          if (typeof key === 'string' && typeof value === 'string') {
            aliases.set(value, [...(aliases.get(value) ?? []), key.replace(/^"|"$/g, '')]);
          }
        }
      }
    }
  } catch {
    // An unparsable document has no usable aliases; the splice step reports the real failure.
  }
  return aliases;
}
