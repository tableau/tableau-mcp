import { Err, Ok, Result } from 'ts-results-es';

import { extractDashboardXml } from '../../metadata/dashboards.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';

export type GetDashboardXmlError = (
  | { type: 'no-dashboard-found' }
  | { type: 'multiple-dashboards-found' }
) & { message: string };

export async function getDashboardXml({
  dashboardName,
  executor,
  signal,
}: { dashboardName: string } & WithExecutorAndAbortSignal): Promise<
  Result<
    string,
    | { type: 'execute-command-error'; error: ExecuteCommandError }
    | { type: 'get-dashboard-xml-error'; error: GetDashboardXmlError }
  >
> {
  const workbookResult = await getWorkbookXml({ executor, signal });
  if (workbookResult.isErr()) {
    return Err({ type: 'execute-command-error', error: workbookResult.error });
  }

  let dashboardXml: string | null;
  try {
    dashboardXml = extractDashboardXml(workbookResult.value, dashboardName);
  } catch (error) {
    return Err({ type: 'execute-command-error', error: { type: 'invalid-response', error } });
  }

  if (dashboardXml === null) {
    return Err({
      type: 'get-dashboard-xml-error',
      error: { type: 'no-dashboard-found', message: `No dashboard found for "${dashboardName}".` },
    });
  }

  return Ok(dashboardXml);
}
