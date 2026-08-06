import { Err, Ok, Result } from 'ts-results-es';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetItem } from '../../../desktop/externalApi/types.js';
import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';

export type SummaryDataRead = <T>(
  endpoint: string,
  read: (
    executor: ExternalApiToolExecutor,
    signal: AbortSignal,
  ) => Promise<Result<T, ExecuteCommandError>>,
) => Promise<Result<T, McpToolError>>;

export type WorksheetSummaryData = {
  worksheet: WorksheetItem;
  columns: unknown[];
  rows: unknown[][];
};

export type WorksheetSummaryDataError =
  | { type: 'worksheet'; error: ArgsValidationError }
  | { type: 'request'; error: McpToolError };

export async function fetchWorksheetSummaryData({
  read,
  worksheet,
  maxRows,
  columns,
}: {
  read: SummaryDataRead;
  worksheet: string | undefined;
  maxRows: number;
  columns?: string[];
}): Promise<Result<WorksheetSummaryData, WorksheetSummaryDataError>> {
  const worksheetsResult = await read(
    'worksheet list',
    async (activeExecutor, activeSignal) => await activeExecutor.listWorksheets(activeSignal),
  );
  if (worksheetsResult.isErr()) {
    return Err({ type: 'request', error: worksheetsResult.error });
  }

  const worksheetResult = resolveWorksheet(worksheet, worksheetsResult.value.worksheets ?? []);
  if (worksheetResult.isErr()) {
    return Err({ type: 'worksheet', error: worksheetResult.error });
  }

  const resolvedWorksheet = worksheetResult.value;
  if (resolvedWorksheet.datasources?.length === 0) {
    return Ok({ worksheet: resolvedWorksheet, columns: [], rows: [] });
  }

  const summaryResult = await read(
    'summary-data',
    async (activeExecutor, activeSignal) =>
      await activeExecutor.getWorksheetSummaryData(
        resolvedWorksheet.id,
        {
          maxRows,
          ...(columns && columns.length > 0
            ? { columnsToIncludeByFieldName: columns.join(',') }
            : {}),
        },
        activeSignal,
      ),
  );
  if (summaryResult.isErr()) {
    return Err({ type: 'request', error: summaryResult.error });
  }

  return Ok({
    worksheet: resolvedWorksheet,
    columns: summaryResult.value.columns ?? [],
    rows: summaryResult.value.rows ?? [],
  });
}

function resolveWorksheet(
  worksheet: string | undefined,
  worksheets: WorksheetItem[],
): Result<WorksheetItem, ArgsValidationError> {
  const requested = worksheet?.trim();
  if (!requested) {
    if (worksheets.length === 1) {
      return new Ok(worksheets[0]);
    }
    return new ArgsValidationError(
      `Multiple worksheets exist. Specify worksheet by name or id. Available worksheets: ${formatWorksheets(
        worksheets,
      )}`,
    ).toErr();
  }

  return resolveItemByNameOrId('Worksheet', worksheet ?? '', worksheets);
}

function formatWorksheets(worksheets: WorksheetItem[]): string {
  return worksheets.map((item) => `${item.name} (${item.id})`).join(', ');
}
