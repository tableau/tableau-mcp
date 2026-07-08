import { Err, Ok, Result } from 'ts-results-es';

import { listWorkbookDashboards } from '../../metadata/dashboards.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';

export async function listDashboards({ executor, signal }: WithExecutorAndAbortSignal): Promise<
  Result<
    {
      count: number;
      dashboards: Array<string>;
    },
    ExecuteCommandError
  >
> {
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return workbookResult;
  }

  let dashboards: Array<string>;
  try {
    dashboards = listWorkbookDashboards(workbookResult.value);
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }

  return Ok({
    count: dashboards.length,
    dashboards,
  });
}
