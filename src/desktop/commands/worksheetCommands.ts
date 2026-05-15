import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ExecuteCommandError, ToolExecutor } from '../toolExecutor/toolExecutor';

export async function getWorkbookXml(
  executor: ToolExecutor,
  sessionId: string,
): Promise<Result<string, ExecuteCommandError>> {
  const result = await executor.executeCommand({
    command: 'tabui',
    namespace: 'save-underlying-metadata',
    args: {
      _session: sessionId,
      'is-json': false,
    },
    schema: z.object({
      text: z.string(),
    }),
  });

  if (result.isErr()) {
    return result;
  }

  return Ok(result.value.parsedResult.text);
}
