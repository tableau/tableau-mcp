import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
import { externalApiReads } from '../../externalApi/externalApiReads.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';

export async function getWorkbookXml({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<Result<string, ExecuteCommandError>> {
  if (getDesktopConfig().externalApiEnabled) {
    const result = await externalApiReads(executor).getWorkbookDocument(signal);
    return result.map((document) => document.xml);
  }

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
