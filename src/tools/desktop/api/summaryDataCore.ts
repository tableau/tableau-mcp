import { Err, Ok, Result } from 'ts-results-es';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { SummaryData, WorksheetItem } from '../../../desktop/externalApi/types.js';
import { ArgsValidationError, McpToolError } from '../../../errors/mcpToolError.js';

export type SummaryDataRead = <T>(
  endpoint: string,
  read: (
    executor: ExternalApiToolExecutor,
    signal: AbortSignal,
  ) => Promise<Result<T, ExecuteCommandError>>,
) => Promise<Result<T, McpToolError>>;

export const SUMMARY_ROW_ORDER = {
  status: 'unspecified',
  usableFor: 'value_readback',
  notUsableFor: 'visual_sort_verification',
} as const;

export type SummaryRowOrder = typeof SUMMARY_ROW_ORDER;

export type WorksheetSummaryData = {
  worksheet: WorksheetItem;
  columns: unknown[];
  rows: unknown[][];
  rowOrder: SummaryRowOrder;
};

export type WorksheetSummaryDataError =
  | { type: 'worksheet'; error: ArgsValidationError }
  | { type: 'columns'; error: ArgsValidationError }
  | { type: 'request'; error: McpToolError };

export async function fetchWorksheetSummaryData({
  read,
  worksheet,
  maxRows,
  columns,
  materializeEmpty = false,
}: {
  read: SummaryDataRead;
  worksheet: string | undefined;
  maxRows: number;
  columns?: string[];
  materializeEmpty?: boolean;
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
    return Ok({
      worksheet: resolvedWorksheet,
      columns: [],
      rows: [],
      rowOrder: SUMMARY_ROW_ORDER,
    });
  }

  // No columnsToIncludeByFieldName: it matches only a column-instance name, not a plain field
  // name, so it would silently no-op. Columns are projected from the returned data below instead.
  const querySummary = async (): Promise<Result<SummaryData, McpToolError>> =>
    await read(
      'summary-data',
      async (activeExecutor, activeSignal) =>
        await activeExecutor.getWorksheetSummaryData(
          resolvedWorksheet.id,
          { maxRows, ignoreSelection: true },
          activeSignal,
        ),
    );

  let summaryResult = await querySummary();
  if (summaryResult.isErr()) {
    return Err({ type: 'request', error: summaryResult.error });
  }

  if (materializeEmpty && (summaryResult.value.columns?.length ?? 0) === 0) {
    const materializeResult = await read(
      'worksheet image',
      async (activeExecutor, activeSignal) =>
        await activeExecutor.exportWorksheetImage(
          resolvedWorksheet.id,
          { mimeType: 'image/png' },
          activeSignal,
        ),
    );
    if (materializeResult.isErr()) {
      return Err({ type: 'request', error: materializeResult.error });
    }
    summaryResult = await querySummary();
    if (summaryResult.isErr()) {
      return Err({ type: 'request', error: summaryResult.error });
    }
  }

  const returnedColumns = summaryResult.value.columns ?? [];
  const returnedRows = summaryResult.value.rows ?? [];
  if (!columns || columns.length === 0) {
    return Ok({
      worksheet: resolvedWorksheet,
      columns: returnedColumns,
      rows: returnedRows,
      rowOrder: SUMMARY_ROW_ORDER,
    });
  }

  const projection = resolveColumnProjection(columns, returnedColumns);
  if (projection.isErr()) {
    return Err({ type: 'columns', error: projection.error });
  }
  return Ok({
    worksheet: resolvedWorksheet,
    columns: projection.value.map((index) => returnedColumns[index]),
    rows: returnedRows.map((row) => projection.value.map((index) => row[index])),
    rowOrder: SUMMARY_ROW_ORDER,
  });
}

function resolveColumnProjection(
  requested: string[],
  returned: unknown[],
): Result<number[], ArgsValidationError> {
  const available = returned.map(columnName);
  const indexes: number[] = [];
  for (const rawRequest of requested) {
    const request = rawRequest.trim();
    const exactMatches = available
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => name === request);
    if (exactMatches.length === 1) {
      indexes.push(exactMatches[0].index);
      continue;
    }

    if (exactMatches.length > 1) {
      return new ArgsValidationError(
        `Requested summary column "${request}" matches more than one returned column: ${exactMatches.map(({ name }) => name).join(', ')}. Available columns: ${available.join(', ') || '(none)'}`,
      ).toErr();
    }

    const normalized = normalizeColumnName(request);
    const matches = available
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => normalizeColumnName(name) === normalized);
    if (matches.length === 1) {
      indexes.push(matches[0].index);
      continue;
    }

    const detail =
      matches.length > 1
        ? `matches more than one returned column: ${matches.map(({ name }) => name).join(', ')}`
        : 'was not returned by the worksheet';
    return new ArgsValidationError(
      `Requested summary column "${request}" ${detail}. Available columns: ${available.join(', ') || '(none)'}`,
    ).toErr();
  }
  return Ok(indexes);
}

function columnName(column: unknown): string {
  if (typeof column !== 'object' || column === null || !('name' in column)) return '';
  return typeof column.name === 'string' ? column.name : '';
}

function normalizeColumnName(name: string): string {
  const trimmed = name.trim().replace(/^\[|\]$/g, '');
  const wrapped = trimmed.match(/^[A-Z][A-Z0-9_ ]*\((.*)\)$/i);
  return (wrapped?.[1] ?? trimmed)
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLocaleLowerCase();
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
