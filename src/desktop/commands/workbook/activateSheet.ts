import { log } from '../../../logging/logger.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { normalizeArray, parseXML } from '../../metadata/parser.js';
import type {
  ParsedDashboard,
  ParsedWindow,
  ParsedWorkbook,
  ParsedWorksheet,
} from '../../metadata/types.js';
import type {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { withApplyLock } from './applyMutex.js';
import { getWorkbookXml } from './getWorkbookXml.js';

export type ActivateSheetResult =
  | { status: 'activated'; previousSheet?: string; availableSheets: string[] }
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

  // Workbook window flags are only pre-navigation context. Live Desktop can leave
  // them stale, so they must never be used to decide whether goto-sheet succeeded.
  const previousSheet = windows.find(
    (window) => window['@_active'] === 'true' || window['@_maximized'] === 'true',
  )?.['@_name'];

  return { status: 'activated', previousSheet, availableSheets };
}

/**
 * Internal navigation path sanctioned only after a fresh workbook read and exact-name
 * validation. The public execute-tableau-command tool applies guardCommand before it
 * resolves an executor; ToolExecutor itself has no guard or agent-facing schema. Calling
 * it here cannot be selected or parameterized by agent input beyond this helper's validated
 * sheetName.
 */
export async function activateSheetWithValidatedGoto({
  sheetName,
  executor,
  signal,
}: {
  sheetName: string;
} & WithExecutorAndAbortSignal): Promise<ActivateSheetResult> {
  return await withApplyLock(async () => {
    const workbookResult = await getWorkbookXml({ executor, signal });
    if (workbookResult.isErr()) {
      return { status: 'read-failed', error: workbookResult.error };
    }

    const inspection = inspectWorkbookForActivation(workbookResult.value, sheetName);
    if (inspection.status !== 'activated') {
      return inspection;
    }

    const commandResult = await executor.executeCommand({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { Sheet: sheetName },
      signal,
    });
    if (commandResult.isErr()) {
      return { status: 'command-failed', error: commandResult.error };
    }

    return inspection;
  });
}

function logBestEffortActivationFailure(
  sheetName: string,
  message: string,
  data: Record<string, unknown>,
): void {
  try {
    log({
      level: 'warning',
      message,
      logger: 'workbookCommands',
      data: { sheetName, ...data },
    });
  } catch {
    // Activation diagnostics must never change the completed primary apply result.
  }
}

/**
 * Follow-up navigation for call sites whose product policy opts into activation.
 * Every failure is best-effort: the already-completed primary apply remains the
 * caller's authoritative result.
 */
export async function activateSheetBestEffort({
  sheetName,
  executor,
  signal,
}: {
  sheetName: string;
} & WithExecutorAndAbortSignal): Promise<void> {
  try {
    const activation = await activateSheetWithValidatedGoto({ sheetName, executor, signal });
    switch (activation.status) {
      case 'activated':
        return;
      case 'not-found':
        logBestEffortActivationFailure(
          sheetName,
          'Best-effort sheet activation skipped; target is absent from the fresh workbook read',
          { availableSheets: activation.availableSheets },
        );
        return;
      case 'parse-failed':
        logBestEffortActivationFailure(
          sheetName,
          'Best-effort sheet activation skipped; could not parse the fresh workbook read',
          { message: activation.message },
        );
        return;
      case 'read-failed':
        logBestEffortActivationFailure(
          sheetName,
          'Best-effort sheet activation skipped; could not re-read the applied workbook',
          { error: activation.error },
        );
        return;
      case 'command-failed':
        logBestEffortActivationFailure(
          sheetName,
          'Best-effort goto-sheet command failed; primary apply remains successful',
          { error: activation.error },
        );
        return;
    }
  } catch (error) {
    logBestEffortActivationFailure(
      sheetName,
      'Best-effort sheet activation threw; primary apply remains successful',
      { error },
    );
  }
}
