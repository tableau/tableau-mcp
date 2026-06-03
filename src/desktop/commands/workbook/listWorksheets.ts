import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';

const worksheetNamesSchema = z.object({
  count: z.number(),
  worksheets: z.array(z.object({ name: z.string() })),
});

export async function listWorksheets({ executor, signal }: WithExecutorAndAbortSignal): Promise<
  Result<
    {
      count: number;
      worksheets: Array<string>;
    },
    ExecuteCommandError
  >
> {
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
