import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
import { listWorkbookDashboards } from '../../metadata/dashboards.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { getWorkbookXml } from './getWorkbookXml.js';

const dashboardNamesSchema = z.object({
  count: z.number(),
  dashboards: z.array(z.object({ name: z.string() })),
});

type ListDashboardsResult = Result<
  {
    count: number;
    dashboards: Array<string>;
  },
  ExecuteCommandError
>;

export async function listDashboards(
  args: WithExecutorAndAbortSignal,
): Promise<ListDashboardsResult> {
  // External Client API ("Athena V0") exposes no per-sheet route — tabui:list-dashboards is not
  // in its command registry. Fetch the whole-workbook document and slice client-side instead.
  return getDesktopConfig().externalApiEnabled
    ? listDashboardsViaExternalApi(args)
    : listDashboardsViaAgentApi(args);
}

async function listDashboardsViaAgentApi({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<ListDashboardsResult> {
  const result = await executor.executeCommand({
    namespace: 'tabui',
    command: 'list-dashboards',
    schema: z.object({
      dashboards: z.string(),
    }),
    signal,
  });

  if (result.isErr()) {
    return result;
  }

  let dashboards: unknown;
  try {
    dashboards = JSON.parse(result.value.parsedResult.dashboards || '[]');
  } catch (e) {
    return Err({ type: 'invalid-response', error: e });
  }

  const dashboardsResult = dashboardNamesSchema.safeParse(dashboards);
  if (!dashboardsResult.success) {
    return Err({ type: 'invalid-response', error: dashboardsResult.error });
  }

  return Ok({
    count: dashboardsResult.data.dashboards.length,
    dashboards: dashboardsResult.data.dashboards.map((dashboard) => dashboard.name),
  });
}

async function listDashboardsViaExternalApi({
  executor,
  signal,
}: WithExecutorAndAbortSignal): Promise<ListDashboardsResult> {
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
