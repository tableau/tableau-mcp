import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import { WorksheetItem } from '../../externalApi/types.js';
import { extractSheetXml } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { decodeXmlEntities } from '../../xmlElement.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { listWorksheets } from './listWorksheets.js';
import { nameMayNeedRawCommandResolution, resolveWorksheetCommandName } from './nameResolution.js';

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
  if (args.executor instanceof ExternalApiToolExecutor) {
    return getWorksheetXmlViaExternalApi(args);
  }
  return getDesktopConfig().externalApiEnabled
    ? getWorksheetXmlViaWorkbookDocument(args)
    : getWorksheetXmlViaAgentApi(args);
}

async function getWorksheetXmlViaAgentApi({
  worksheetName,
  executor,
  signal,
}: { worksheetName: string } & WithExecutorAndAbortSignal): Promise<GetWorksheetXmlResult> {
  const result = await getWorksheetXmlViaAgentApiName({ worksheetName, executor, signal });
  if (result.isOk() || !nameMayNeedRawCommandResolution(worksheetName)) {
    return result;
  }

  if (
    result.error.type !== 'get-worksheet-xml-error' ||
    result.error.error.type !== 'no-worksheet-found'
  ) {
    return result;
  }

  const commandName = await resolveWorksheetCommandName(worksheetName, { executor, signal });
  if (!commandName || commandName === worksheetName) {
    return result;
  }

  return getWorksheetXmlViaAgentApiName({
    worksheetName: commandName,
    requestedWorksheetName: worksheetName,
    executor,
    signal,
  });
}

async function getWorksheetXmlViaAgentApiName({
  worksheetName,
  requestedWorksheetName = worksheetName,
  executor,
  signal,
}: {
  worksheetName: string;
  requestedWorksheetName?: string;
} & WithExecutorAndAbortSignal): Promise<GetWorksheetXmlResult> {
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
    const didYouMean = await worksheetNameSuggestions(requestedWorksheetName, { executor, signal });
    return Err({
      type: 'get-worksheet-xml-error',
      error: {
        type: 'no-worksheet-found',
        message: `No worksheet found for ${requestedWorksheetName}.${didYouMean}`,
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
  if (!(executor instanceof ExternalApiToolExecutor)) {
    return getWorksheetXmlViaAgentApi({ worksheetName, executor, signal });
  }

  const worksheetsResult = await executor.listWorksheets(signal);
  if (worksheetsResult.isErr()) {
    return Err({ type: 'execute-command-error', error: worksheetsResult.error });
  }

  const worksheetResult = resolveExternalApiWorksheet(
    worksheetName,
    worksheetsResult.value.worksheets ?? [],
  );
  if (worksheetResult.isErr()) {
    const didYouMean = await worksheetNameSuggestions(worksheetName, { executor, signal });
    return Err({
      type: 'get-worksheet-xml-error',
      error: {
        ...worksheetResult.error,
        message: `${worksheetResult.error.message}${didYouMean}`,
      },
    });
  }

  const documentResult = await executor.getWorksheetDocument(worksheetResult.value.id, signal);
  if (documentResult.isErr()) {
    return Err({ type: 'execute-command-error', error: documentResult.error });
  }

  return Ok(documentResult.value.xml);
}

async function getWorksheetXmlViaWorkbookDocument({
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

function resolveExternalApiWorksheet(
  worksheetName: string,
  worksheets: WorksheetItem[],
): Result<WorksheetItem, GetWorksheetXmlError> {
  const requested = worksheetName.trim();
  const requestedNames = unique([requested, decodeXmlEntities(requested)]);

  const idMatch = worksheets.find((candidate) => candidate.id === requested);
  if (idMatch) {
    return Ok(idMatch);
  }

  const nameMatches = worksheets.filter((candidate) => requestedNames.includes(candidate.name));
  if (nameMatches.length === 1) {
    return Ok(nameMatches[0]);
  }

  if (nameMatches.length > 1) {
    return Err({
      type: 'multiple-worksheets-found',
      message: `Worksheet "${worksheetName}" matched multiple worksheets. Specify one id: ${formatWorksheets(
        nameMatches,
      )}.`,
    });
  }

  return Err({
    type: 'no-worksheet-found',
    message: `No worksheet found for ${worksheetName}.`,
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatWorksheets(worksheets: WorksheetItem[]): string {
  return worksheets.map((worksheet) => `${worksheet.name} (${worksheet.id})`).join(', ');
}

/** A problem-404 route miss: the endpoint is newer than this Desktop build. */
export function isRouteMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as { type?: string; error?: { code?: string; message?: string } };
  return (
    e.type === 'command-failed' &&
    e.error?.code === 'not-found' &&
    typeof e.error?.message === 'string' &&
    e.error.message.includes('No route matches')
  );
}
