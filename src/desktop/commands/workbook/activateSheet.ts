import type { Result } from 'ts-results-es';

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
  ExecuteCommandResult,
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

type FocusVerificationResult =
  | { status: 'focused'; activeSheet?: string; availableSheets: string[] }
  | { status: 'not-focused'; activeSheet?: string; availableSheets: string[] }
  | { status: 'not-found'; availableSheets: string[] }
  | { status: 'parse-failed'; message: string }
  | { status: 'read-failed'; error: ExecuteCommandError };

const APPLY_SETTLE_MS = 500;
const ACTIVATION_VERIFY_MS = 700;

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

function inspectWorkbookFocus(
  workbookXml: string,
  sheetName: string,
): Exclude<FocusVerificationResult, { status: 'read-failed' }> {
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

  const activeSheet = windows.find(
    (window) => window['@_active'] === 'true' || window['@_maximized'] === 'true',
  )?.['@_name'];
  const targetFocused = windows.some(
    (window) =>
      window['@_name'] === sheetName &&
      (window['@_active'] === 'true' || window['@_maximized'] === 'true'),
  );

  return targetFocused
    ? { status: 'focused', activeSheet, availableSheets }
    : { status: 'not-focused', activeSheet, availableSheets };
}

async function verifySheetFocus({
  sheetName,
  executor,
  signal,
}: {
  sheetName: string;
} & WithExecutorAndAbortSignal): Promise<FocusVerificationResult> {
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return { status: 'read-failed', error: workbookResult.error };
  }

  return inspectWorkbookFocus(workbookResult.value, sheetName);
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

async function waitForDesktopSettle(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, ms);

    function finish(): void {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    }

    signal.addEventListener('abort', finish, { once: true });
  });
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

    const commandResult = await executeGotoSheet({ sheetName, executor, signal });
    if (commandResult.isErr()) {
      return { status: 'command-failed', error: commandResult.error };
    }

    return inspection;
  });
}

function logBestEffortActivationEvent(
  sheetName: string,
  level: 'info' | 'warning',
  message: string,
  data: Record<string, unknown>,
): void {
  try {
    log({
      level,
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
    await waitForDesktopSettle(APPLY_SETTLE_MS, signal);

    const activation = await activateSheetWithValidatedGoto({ sheetName, executor, signal });
    switch (activation.status) {
      case 'activated':
        break;
      case 'not-found':
        logBestEffortActivationEvent(
          sheetName,
          'warning',
          'Best-effort sheet activation skipped; target is absent from the fresh workbook read',
          { availableSheets: activation.availableSheets },
        );
        return;
      case 'parse-failed':
        logBestEffortActivationEvent(
          sheetName,
          'warning',
          'Best-effort sheet activation skipped; could not parse the fresh workbook read',
          { message: activation.message },
        );
        return;
      case 'read-failed':
        logBestEffortActivationEvent(
          sheetName,
          'warning',
          'Best-effort sheet activation skipped; could not re-read the applied workbook',
          { error: activation.error },
        );
        return;
      case 'command-failed':
        logBestEffortActivationEvent(
          sheetName,
          'warning',
          'Best-effort goto-sheet command failed; primary apply remains successful',
          { error: activation.error },
        );
        return;
    }

    await waitForDesktopSettle(ACTIVATION_VERIFY_MS, signal);

    const verification = await verifySheetFocus({ sheetName, executor, signal });
    switch (verification.status) {
      case 'focused':
        logBestEffortActivationEvent(
          sheetName,
          'info',
          'Best-effort sheet activation verified target focus after Desktop settle',
          { activeSheet: verification.activeSheet },
        );
        return;
      case 'not-focused': {
        const reissue = await executeGotoSheet({ sheetName, executor, signal });
        if (reissue.isErr()) {
          logBestEffortActivationEvent(
            sheetName,
            'warning',
            'Best-effort goto-sheet reissue failed after Desktop settle; primary apply remains successful',
            { activeSheet: verification.activeSheet, error: reissue.error },
          );
          return;
        }
        logBestEffortActivationEvent(
          sheetName,
          'info',
          'Best-effort goto-sheet reissued once after Desktop settle verification',
          { activeSheet: verification.activeSheet },
        );
        return;
      }
      case 'not-found':
        logBestEffortActivationEvent(
          sheetName,
          'warning',
          'Best-effort sheet activation verification skipped; target disappeared from the workbook read',
          { availableSheets: verification.availableSheets },
        );
        return;
      case 'parse-failed':
        logBestEffortActivationEvent(
          sheetName,
          'warning',
          'Best-effort sheet activation verification skipped; could not parse the settled workbook read',
          { message: verification.message },
        );
        return;
      case 'read-failed':
        logBestEffortActivationEvent(
          sheetName,
          'warning',
          'Best-effort sheet activation verification skipped; could not re-read the settled workbook',
          { error: verification.error },
        );
        return;
    }
  } catch (error) {
    logBestEffortActivationEvent(
      sheetName,
      'warning',
      'Best-effort sheet activation threw; primary apply remains successful',
      { error },
    );
  }
}
