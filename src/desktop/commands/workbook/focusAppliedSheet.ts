import { log } from '../../../logging/logger.js';
import { WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor.js';
import { listDashboards } from './listDashboards.js';
import { listWorksheets } from './listWorksheets.js';
import {
  nameMayNeedRawCommandResolution,
  resolveDashboardCommandName,
  resolveWorksheetCommandName,
} from './nameResolution.js';

type ApplyCommand = 'load-worksheet' | 'load-dashboard';

// goto-sheet at a name Desktop doesn't know throws a BLOCKING modal
// (47BF7751 "bad value: sheet") instead of returning an error — and an apply
// is async enough that its sheet can be missing at focus time (live-reproduced
// twice, 2026-07-19). Confirm the sheet exists before offering to focus it;
// a skipped focus is a log line, a modal is a wedged stage.
const FOCUS_POLL_ATTEMPTS = 4;
const FOCUS_POLL_DELAY_MS = 250;

async function appliedSheetVisible({
  sheetName,
  appliedVia,
  executor,
  signal,
}: {
  sheetName: string;
  appliedVia: ApplyCommand;
} & WithExecutorAndAbortSignal): Promise<boolean> {
  for (let attempt = 0; attempt < FOCUS_POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, FOCUS_POLL_DELAY_MS));
    }
    if (appliedVia === 'load-dashboard') {
      const result = await listDashboards({ executor, signal });
      if (result.isOk() && result.value.dashboards.includes(sheetName)) {
        return true;
      }
    } else {
      const result = await listWorksheets({ executor, signal });
      if (result.isOk() && result.value.worksheets.includes(sheetName)) {
        return true;
      }
    }
  }
  return false;
}

export async function focusAppliedSheetBestEffort({
  sheetName,
  appliedVia,
  executor,
  signal,
}: {
  sheetName: string;
  appliedVia: ApplyCommand;
} & WithExecutorAndAbortSignal): Promise<void> {
  try {
    if (!(await appliedSheetVisible({ sheetName, appliedVia, executor, signal }))) {
      log({
        level: 'warning',
        message:
          'skipping goto-sheet: applied sheet not visible yet — focusing an unknown name throws a blocking Desktop modal',
        logger: 'workbookCommands',
        data: { sheetName, appliedVia },
      });
      return;
    }

    const commandSheetName = nameMayNeedRawCommandResolution(sheetName)
      ? appliedVia === 'load-dashboard'
        ? ((await resolveDashboardCommandName(sheetName, { executor, signal })) ?? sheetName)
        : ((await resolveWorksheetCommandName(sheetName, { executor, signal })) ?? sheetName)
      : sheetName;

    const result = await executor.executeCommand({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { sheet: commandSheetName },
      signal,
    });

    if (result.isErr()) {
      log({
        level: 'warning',
        message: 'goto-sheet failed after successful apply; continuing',
        logger: 'workbookCommands',
        data: { sheetName, appliedVia, error: result.error },
      });
      return;
    }

    if (result.value.status !== 'completed') {
      log({
        level: 'warning',
        message: 'goto-sheet did not complete after successful apply; continuing',
        logger: 'workbookCommands',
        data: {
          sheetName,
          appliedVia,
          status: result.value.status,
          commandId: result.value.command_id,
          error: result.value.error,
        },
      });
    }
  } catch (error) {
    log({
      level: 'warning',
      message: 'goto-sheet threw after successful apply; continuing',
      logger: 'workbookCommands',
      data: {
        sheetName,
        appliedVia,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
