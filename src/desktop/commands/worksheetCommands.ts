import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ExecuteCommandError, ToolExecutor } from '../toolExecutor/toolExecutor';

export async function getWorkbookXml({
  executor,
  session,
  signal,
}: {
  executor: ToolExecutor;
  session: string;
  signal: AbortSignal;
}): Promise<Result<string, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    command: 'tabui',
    namespace: 'save-underlying-metadata',
    args: {
      _session: session,
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
