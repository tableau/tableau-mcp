import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ExecuteCommandError, ToolExecutor } from '../toolExecutor/toolExecutor';

export async function getWorkbookXml({
  executor,
  signal,
}: {
  executor: ToolExecutor;
  signal: AbortSignal;
}): Promise<Result<string, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'save-underlying-metadata',
    args: {
      'is-json': false,
    },
    schema: z.string(),
    signal,
  });

  if (result.isErr()) {
    return result;
  }

  return Ok(result.value.parsedResult);
}
