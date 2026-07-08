import { Err, Ok, Result } from 'ts-results-es';

import { extractSheetXml } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';

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
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return Err({ type: 'execute-command-error', error: workbookResult.error });
  }

  let worksheetXml: string | null;
  try {
    worksheetXml = extractSheetXml(workbookResult.value, worksheetName);
  } catch (error) {
    return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
  }

  if (worksheetXml === null) {
    return Err({
      type: 'get-worksheet-xml-error',
      error: { type: 'no-worksheet-found', message: `No worksheet found for ${worksheetName}.` },
    });
  }

  return Ok(worksheetXml);
}
