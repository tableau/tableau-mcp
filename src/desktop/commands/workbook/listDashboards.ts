import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../../config.desktop.js';
import {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../../toolExecutor/toolExecutor.js';
import { listDashboardItems } from './sheetItems.js';

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
  const result = await listDashboardItems({ executor, signal });
  if (result.isErr()) {
    return result;
  }

  const dashboards = result.value.map((item) => item.name);
  return Ok({
    count: dashboards.length,
    dashboards,
  });
}
