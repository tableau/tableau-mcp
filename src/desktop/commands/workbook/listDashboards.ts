import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ExecuteCommandError, WithExecutorAndAbortSignal } from '../../toolExecutor/toolExecutor';

const dashboardNamesSchema = z.array(z.object({ name: z.string() }));

export async function listDashboards({ executor, signal }: WithExecutorAndAbortSignal): Promise<
  Result<
    {
      count: number;
      dashboards: Array<string>;
    },
    ExecuteCommandError
  >
> {
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
    count: dashboardsResult.data.length,
    dashboards: dashboardsResult.data.map((dashboard) => dashboard.name),
  });
}
