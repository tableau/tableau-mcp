import { Result } from 'ts-results-es';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { LogicalTableList } from '../../../desktop/externalApi/types.js';
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
