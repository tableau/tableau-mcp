import { Err, Ok, Result } from 'ts-results-es';

import { listWorkbookDashboards } from '../../metadata/dashboards.js';
import { listSheets } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';

// Deletes a live worksheet or dashboard via tabdoc:delete-sheet so a following additive workbook
// POST re-adds the edited copy without a name-collision duplicate. A no-op when the sheet is absent,
// so applying a brand-new sheet is safe.
export async function deleteLiveSheet({
  sheetName,
  executor,
  signal,
}: { sheetName: string } & WithExecutorAndAbortSignal): Promise<Result<void, ExecuteCommandError>> {
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return workbookResult;
  }

  let present: boolean;
  try {
    present =
      listSheets(workbookResult.value).includes(sheetName) ||
      listWorkbookDashboards(workbookResult.value).includes(sheetName);
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }

  if (!present) {
    return Ok.EMPTY;
  }

  const result = await executor.executeCommand({
    namespace: 'tabdoc',
    command: 'delete-sheet',
    args: { Sheet: sheetName },
    signal,
  });

  if (result.isErr()) {
    return result;
  }

  return Ok.EMPTY;
}
