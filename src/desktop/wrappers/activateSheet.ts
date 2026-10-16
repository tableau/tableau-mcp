import type { Result } from 'ts-results-es';

import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import type {
  ExecuteCommandError,
  ExecuteCommandResult,
  WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type {
  ParsedDashboard,
  ParsedWindow,
  ParsedWorkbook,
  ParsedWorksheet,
} from '../metadata/types.js';
import { withApplyLock } from './applyMutex.js';
import { getWorkbookXml } from './getWorkbookXml.js';

export type ActivateSheetResult =
  | { status: 'activated'; previousSheet?: string; availableSheets: string[] }
  | { status: 'already-active'; previousSheet: string; availableSheets: string[] }
  | { status: 'not-found'; availableSheets: string[] }
  | { status: 'parse-failed'; message: string }
  | { status: 'read-failed'; error: ExecuteCommandError }
  | { status: 'command-failed'; error: ExecuteCommandError };

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function namedWindows(workbook: ParsedWorkbook): ParsedWindow[] {
  return normalizeArray<ParsedWindow>(workbook.workbook?.windows?.window).filter(
    (window) =>
      typeof window['@_name'] === 'string' &&
      ['worksheet', 'dashboard'].includes(String(window['@_class'])),
  );
}

function availableSheetNames(workbook: ParsedWorkbook): string[] {
  const worksheetNames = normalizeArray<ParsedWorksheet>(
    workbook.workbook?.worksheets?.worksheet,
  ).map((worksheet) => worksheet['@_name']);
  const dashboardNames = normalizeArray<ParsedDashboard>(
    workbook.workbook?.dashboards?.dashboard,
  ).map((dashboard) => dashboard['@_name']);
  return unique([...worksheetNames, ...dashboardNames].filter((name): name is string => !!name));
}

function inspectWorkbookForActivation(
  workbookXml: string,
  sheetName: string,
): Exclude<ActivateSheetResult, { status: 'read-failed' | 'command-failed' }> {
  let workbook: ParsedWorkbook;
  try {
    workbook = parseXML(workbookXml);
  } catch (error) {
    return { status: 'parse-failed', message: getExceptionMessage(error) };
  }

  const windows = namedWindows(workbook);
  const availableSheets = availableSheetNames(workbook);
  if (!availableSheets.includes(sheetName)) {
    return { status: 'not-found', availableSheets };
  }

  const previousSheet = windows.find(
    (window) => window['@_active'] === 'true' || window['@_maximized'] === 'true',
  )?.['@_name'];

  // Already there: skip the dispatch. goto-sheet records an undo entry, so a redundant
  // one costs the user their first Cmd-Z. This read is the one the name validation
  // already needed, so the check is free.
  if (previousSheet === sheetName) {
    return { status: 'already-active', previousSheet, availableSheets };
  }

  return { status: 'activated', previousSheet, availableSheets };
}

async function executeGotoSheet({
  sheetName,
  executor,
  signal,
}: {
  sheetName: string;
} & WithExecutorAndAbortSignal): Promise<
  Result<ExecuteCommandResult<undefined>, ExecuteCommandError>
> {
  return await executor.executeCommand({
    namespace: 'tabdoc',
    command: 'goto-sheet',
    args: { Sheet: sheetName },
    signal,
  });
}

/**
 * Internal navigation path sanctioned only after a fresh workbook read and exact-name
 * validation. The public execute-tableau-command tool applies guardCommand before it
 * resolves an executor; ExternalApiToolExecutor itself has no guard or agent-facing schema. Calling
 * it here cannot be selected or parameterized by agent input beyond this helper's validated
 * sheetName.
 *
 * Lock-free: the post-apply focus dispatch already holds the apply lock, and withApplyLock
 * is a promise chain rather than a reentrant mutex, so taking it again from in there would
 * deadlock. Callers that are not already holding the lock use activateSheetWithValidatedGoto.
 */
export async function activateSheetValidated({
  sheetName,
  executor,
  signal,
}: {
  sheetName: string;
} & WithExecutorAndAbortSignal): Promise<ActivateSheetResult> {
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return { status: 'read-failed', error: workbookResult.error };
  }

  const inspection = inspectWorkbookForActivation(workbookResult.value, sheetName);
  if (inspection.status !== 'activated') {
    return inspection;
  }

  const commandResult = await executeGotoSheet({ sheetName, executor, signal });
  if (commandResult.isErr()) {
    return { status: 'command-failed', error: commandResult.error };
  }

  return inspection;
}

/** The same validated navigation, serialized against in-flight applies. */
export async function activateSheetWithValidatedGoto(
  params: { sheetName: string } & WithExecutorAndAbortSignal,
): Promise<ActivateSheetResult> {
  return await withApplyLock(() => activateSheetValidated(params));
}
