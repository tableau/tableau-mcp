import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';

export type GetWorksheetXmlError = (
  | { type: 'no-worksheet-found' }
  | { type: 'multiple-worksheets-found' }
) & { message: string };

export async function getWorksheetXml({
  worksheetName,
  executor,
  signal,
}: { worksheetName: string } & WithExecutorAndAbortSignal): Promise<
  Result<
    string,
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'get-worksheet-xml-error'; error: GetWorksheetXmlError }
  >
> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'save-worksheet',
    args: {
      worksheetName,
    },
    schema: z.object({
      worksheetXml: z.string(),
    }),
    signal,
  });

  if (result.isErr()) {
    return Err({ type: 'execute-command-error', error: result.error });
  }

  const worksheetXml = result.value.parsedResult.worksheetXml;
  const worksheetCount = (worksheetXml.match(/<worksheet/g) || []).length;

  if (worksheetCount === 0) {
    return Err({
      type: 'get-worksheet-xml-error',
      error: { type: 'no-worksheet-found', message: `No worksheet found for ${worksheetName}.` },
    });
  }

  if (worksheetCount > 1) {
    return Err({
      type: 'get-worksheet-xml-error',
      error: {
        type: 'multiple-worksheets-found',
        message: `${worksheetCount} worksheets found instead of 1.`,
      },
    });
  }

  return Ok(worksheetXml);
}
