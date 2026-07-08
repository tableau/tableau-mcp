import { Err, Ok, Result } from 'ts-results-es';

import { listSheets } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';

export async function listWorksheets({ executor, signal }: WithExecutorAndAbortSignal): Promise<
  Result<
    {
      count: number;
      worksheets: Array<string>;
    },
    ExecuteCommandError
  >
> {
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return workbookResult;
  }

  let worksheets: Array<string>;
  try {
    worksheets = listSheets(workbookResult.value);
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }

  return Ok({
    count: worksheets.length,
    worksheets,
  });
}
