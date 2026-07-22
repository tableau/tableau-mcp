import { Ok, Result } from 'ts-results-es';

import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';

export async function getWorkbookXml({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<string, ExecuteCommandError>> {
  const result = await executor.getWorkbookDocument(signal);

  if (result.isErr()) {
    return result;
  }

  return Ok(result.value.xml);
}
