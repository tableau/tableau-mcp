import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
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

type GetWorksheetXmlResult = Result<
  string,
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'get-worksheet-xml-error'; error: GetWorksheetXmlError }
>;

export async function getWorksheetXml(
  args: { worksheetName: string } & WithExecutorAndAbortSignal,
): Promise<GetWorksheetXmlResult> {
  // External Client API ("Athena V0") exposes no per-sheet route — tabui:save-worksheet is not
  // in its command registry. Fetch the whole-workbook document and slice client-side instead.
  return getDesktopConfig().externalApiEnabled
    ? getWorksheetXmlViaExternalApi(args)
    : getWorksheetXmlViaAgentApi(args);
}

async function getWorksheetXmlViaAgentApi({
  worksheetName,
  executor,
  signal,
}: { worksheetName: string } & WithExecutorAndAbortSignal): Promise<GetWorksheetXmlResult> {
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

async function getWorksheetXmlViaExternalApi({
  worksheetName,
  executor,
  signal,
}: { worksheetName: string } & WithExecutorAndAbortSignal): Promise<GetWorksheetXmlResult> {
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
