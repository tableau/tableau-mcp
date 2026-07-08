import { Err, Ok, Result } from 'ts-results-es';

import { listSheets } from '../../metadata/sheets.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';
import { SCRATCH_PREFIX } from './loadWorkbookXml.js';

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
    worksheets = listSheets(workbookResult.value).filter(
      (name) => !name.startsWith(SCRATCH_PREFIX),
    );
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }

  return Ok({
    count: worksheets.length,
    worksheets,
  });
}
