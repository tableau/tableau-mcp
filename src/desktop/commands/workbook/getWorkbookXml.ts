import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';

export async function getWorkbookXml({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<string, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'save-underlying-metadata',
    args: {
      'is-json': false,
    },
    schema: z.object({
      text: z.string(),
    }),
    signal,
  });

  if (result.isErr()) {
    return result;
  }

  return Ok(result.value.parsedResult.text);
}
