import { Err, Ok, Result } from 'ts-results-es';

import { externalApiReads } from '../../externalApi/externalApiReads.js';
import { SummaryData } from '../../externalApi/types.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { findByName, listWorksheetItems } from './sheetItems.js';

export type WorksheetSummaryData = SummaryData;

export type GetWorksheetSummaryDataError = { type: 'no-worksheet-found' } & { message: string };

type GetWorksheetSummaryDataResult = Result<
  WorksheetSummaryData,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'get-worksheet-summary-data-error'; error: GetWorksheetSummaryDataError }
>;

export async function getWorksheetSummaryData({
  worksheetName,
  maxRows,
  executor,
  signal,
}: {
  worksheetName: string;
  maxRows?: number;
} & WithExecutorAndAbortSignal): Promise<GetWorksheetSummaryDataResult> {
  const listed = await listWorksheetItems({ executor, signal });
  if (listed.isErr()) {
    return Err({ type: 'execute-command-error', error: listed.error });
  }

  const worksheet = findByName(listed.value, worksheetName);
  if (!worksheet) {
    return Err({
      type: 'get-worksheet-summary-data-error',
      error: { type: 'no-worksheet-found', message: `No worksheet found for "${worksheetName}".` },
    });
  }

  const result = await externalApiReads(executor).getWorksheetSummaryData(
    worksheet.id,
    { maxRows },
    signal,
  );
  if (result.isErr()) {
    return Err({ type: 'execute-command-error', error: result.error });
  }

  return Ok(result.value);
}
