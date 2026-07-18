import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { listWorksheetItems } from './sheetItems.js';

const worksheetNamesSchema = z.object({
  count: z.number(),
  worksheets: z.array(z.object({ name: z.string() })),
});

type ListWorksheetsResult = Result<
  {
    count: number;
    worksheets: Array<string>;
  },
  ExecuteCommandError
>;

export async function listWorksheets(
  args: WithExecutorAndAbortSignal,
): Promise<ListWorksheetsResult> {
  return getDesktopConfig().externalApiEnabled
    ? listWorksheetsViaExternalApi(args)
    : listWorksheetsViaAgentApi(args);
}

async function listWorksheetsViaAgentApi({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<ListWorksheetsResult> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'list-worksheets',
    schema: z.object({
      worksheets: z.string(),
    }),
    signal,
  });

  if (result.isErr()) {
    return result;
  }

  let worksheets: unknown;
  try {
    worksheets = JSON.parse(result.value.parsedResult.worksheets || '[]');
  } catch (e) {
    return Err({ type: 'invalid-response', error: e });
  }

  const worksheetsResult = worksheetNamesSchema.safeParse(worksheets);
  if (!worksheetsResult.success) {
    return Err({ type: 'invalid-response', error: worksheetsResult.error });
  }

  return Ok({
    count: worksheetsResult.data.worksheets.length,
    worksheets: worksheetsResult.data.worksheets.map((worksheet) => worksheet.name),
  });
}

async function listWorksheetsViaExternalApi({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<ListWorksheetsResult> {
  const result = await listWorksheetItems({ executor, signal });
  if (result.isErr()) {
    return result;
  }

  const worksheets = result.value.map((item) => item.name);
  return Ok({
    count: worksheets.length,
    worksheets,
  });
}
