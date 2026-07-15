import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
import { extractSheetXml } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { listWorksheets } from './listWorksheets.js';

/**
 * Best-effort "did you mean" suffix for a worksheet-name miss (W6, cluster H). Lists the
 * live sheet names, surfaces close matches (case-insensitive substring either direction)
 * first, and tells the agent to ask the user rather than guess when nothing clearly
 * matches. Never throws; returns '' when the list is unavailable — zero cost on success.
 */
async function worksheetNameSuggestions(
  missName: string,
  { executor, signal }: WithExecutorAndAbortSignal,
): Promise<string> {
  try {
    const listed = await listWorksheets({ executor, signal });
    if (listed.isErr()) return '';
    const names = listed.value.worksheets.filter((n) => !!n);
    if (names.length === 0) return '';

    const needle = missName.toLowerCase();
    const close = names.filter((n) => {
      const hay = n.toLowerCase();
      return hay.includes(needle) || needle.includes(hay);
    });
    const candidates = (close.length > 0 ? close : names).slice(0, 12);
    const heading = close.length > 0 ? 'Did you mean' : 'Available worksheets';
    return (
      ` ${heading}: ${candidates.map((n) => `"${n}"`).join(', ')}.` +
      ' If it is not obvious which sheet the user meant, ask the user instead of guessing.'
    );
  } catch {
    return '';
  }
}

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
    const didYouMean = await worksheetNameSuggestions(worksheetName, { executor, signal });
    return Err({
      type: 'get-worksheet-xml-error',
      error: {
        type: 'no-worksheet-found',
        message: `No worksheet found for ${worksheetName}.${didYouMean}`,
      },
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
    const didYouMean = await worksheetNameSuggestions(worksheetName, { executor, signal });
    return Err({
      type: 'get-worksheet-xml-error',
      error: {
        type: 'no-worksheet-found',
        message: `No worksheet found for ${worksheetName}.${didYouMean}`,
      },
    });
  }

  return Ok(worksheetXml);
}
