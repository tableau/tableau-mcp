import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import {
  endpointNotInThisBuild,
  resolveItemByNameOrId,
} from '../../../desktop/externalApi/toolUtils.js';
import { DashboardItem } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { attachNextAction, prefillNextAction } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  dashboard: z
    .string()
    .describe('Dashboard name or stable id whose pending automatic updates should run now.'),
};
const title = 'Refresh Dashboard Auto Updates';

export const getRefreshDashboardAutoUpdatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'refresh-dashboard-auto-updates',
    minApiVersion: '0.2.19',
    title,
    description:
      'Run pending automatic updates for every worksheet controller in one dashboard now without activating it.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, dashboard }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, dashboard },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const dashboardResult = await resolveDashboardRef({ session, dashboard, extra });
          if (dashboardResult.isErr()) {
            return dashboardResult.error.toErr();
          }
          const target = dashboardResult.value;

          const executor = await extra.getExecutor(sessionResult.value);
          const result = await executor.refreshDashboardNow(target.id, extra.signal);
          if (result.isErr()) {
            if (isRefreshRouteMissing(result.error)) {
              return endpointNotInThisBuild('refresh-dashboard-auto-updates').toErr();
            }
            if (result.error.type === 'command-failed' && result.error.result !== undefined) {
              return new IncompleteOperationError(
                attachNextAction(
                  {
                    dashboard: { id: target.id, name: target.name },
                    ...result.error.result,
                    error: result.error.error,
                  },
                  prefillNextAction('Review failed dashboard refresh targets'),
                ),
              ).toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            dashboard: { id: target.id, name: target.name },
            ...result.value.parsedResult,
            message: `Refreshed auto-updates for dashboard "${target.name}".`,
          });
        },
      });
    },
  });

  return tool;
};

async function resolveDashboardRef({
  session,
  dashboard,
  extra,
}: {
  session: string | undefined;
  dashboard: string;
  extra: Parameters<typeof runExternalApiReadTool>[0]['extra'];
}): ReturnType<typeof runExternalApiReadTool<DashboardItem>> {
  return await runExternalApiReadTool<DashboardItem>({
    session,
    extra,
    callback: async (_executor, _signal, read) => {
      const dashboards = await read(
        'dashboard list',
        async (executor, signal) => await executor.listDashboards(signal),
      );
      if (dashboards.isErr()) {
        return dashboards;
      }
      return resolveItemByNameOrId('Dashboard', dashboard, dashboards.value.dashboards ?? []);
    },
  });
}

function isRefreshRouteMissing(error: ExecuteCommandError): boolean {
  return error.type === 'command-failed' && error.error?.code === 'not-found';
}
