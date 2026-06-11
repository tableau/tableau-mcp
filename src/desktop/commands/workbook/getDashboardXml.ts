import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';

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
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'save-dashboard',
    args: {
      dashboardName,
    },
    schema: z.object({
      dashboardXml: z.string(),
    }),
    signal,
  });

  if (result.isErr()) {
    return Err({ type: 'execute-command-error', error: result.error });
  }

  const dashboardXml = result.value.parsedResult.dashboardXml;
  const dashboardCount = (dashboardXml.match(/<dashboard/g) || []).length;

  if (dashboardCount === 0) {
    return Err({
      type: 'get-dashboard-xml-error',
      error: { type: 'no-dashboard-found', message: `No dashboard found for "${dashboardName}".` },
    });
  }

  if (dashboardCount > 1) {
    return Err({
      type: 'get-dashboard-xml-error',
      error: {
        type: 'multiple-dashboards-found',
        message: `${dashboardCount} dashboards found instead of 1.`,
      },
    });
  }

  return Ok(dashboardXml);
}
