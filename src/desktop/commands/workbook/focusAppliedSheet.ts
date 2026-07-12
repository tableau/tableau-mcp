import { log } from '../../../logging/logger.js';
import { WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor.js';

type ApplyCommand = 'load-worksheet' | 'load-dashboard';

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
    const result = await executor.executeCommand({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { sheet: sheetName },
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
