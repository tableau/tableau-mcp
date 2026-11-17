import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';

import { DesktopCache } from '../../../desktop/cache.js';
import { writeCacheTextFile } from '../../../desktop/cachePath.js';
import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { DataTable, LogicalTableList } from '../../../desktop/externalApi/types.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';

export function resolveLogicalTable(
  logicalTableId: string,
  list: LogicalTableList,
): Result<{ id: string; name: string }, ArgsValidationError> {
  const tables = (list.tables ?? []).map((table) => ({
    id: table.id ?? '',
    name: table.caption ?? table.id ?? '',
  }));
  return resolveItemByNameOrId('Logical table', logicalTableId, tables);
}

export function rowParamsWithoutTable(
  rowParams: Record<string, unknown>,
): ArgsValidationError | undefined {
  const passed = Object.keys(rowParams).filter((key) => rowParams[key] !== undefined);
  if (passed.length === 0) {
    return undefined;
  }
  return new ArgsValidationError(
    `${passed.join(', ')} ${passed.length === 1 ? 'applies' : 'apply'} only when reading rows. Pass logicalTableId, or omit ${passed.length === 1 ? 'it' : 'them'} to list the logical tables.`,
  );
}

export function buildRowsToolResult({
  rows: table,
  mode,
  cachePrefix,
}: {
  rows: DataTable;
  mode: 'file' | 'inline';
  cachePrefix: string;
}): CallToolResult {
  const text = JSON.stringify(table);
  if (mode === 'inline') {
    return { isError: false, content: [{ type: 'text', text }] };
  }
  const cacheFile = new DesktopCache().getCacheFilePath({ prefix: cachePrefix, extension: 'json' });
  writeCacheTextFile(cacheFile, text);
  const rowCount = table.rows?.length ?? 0;
  const columnCount = table.columns?.length ?? 0;
  return {
    isError: false,
    content: [
      {
        type: 'text',
        text: `Saved ${rowCount} rows x ${columnCount} columns to cache file: ${cacheFile}`,
      },
    ],
  };
}
