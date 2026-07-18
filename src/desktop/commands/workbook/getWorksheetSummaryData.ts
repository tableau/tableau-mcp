import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { findByName, listWorksheetItems } from './sheetItems.js';

const summaryDataSchema = z.object({
  columns: z
    .array(z.object({ name: z.string().optional(), dataType: z.string().optional() }).passthrough())
    .optional(),
  rows: z.array(z.array(z.unknown())).optional(),
});

export type WorksheetSummaryData = z.infer<typeof summaryDataSchema>;

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

  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'get-worksheet-summary-data',
    args: { id: worksheet.id, ...(maxRows !== undefined ? { maxRows } : {}) },
    schema: summaryDataSchema,
    signal,
  });
  if (result.isErr()) {
    return Err({ type: 'execute-command-error', error: result.error });
  }

  return Ok(result.value.parsedResult);
}
