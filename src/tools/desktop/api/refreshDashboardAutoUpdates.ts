import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ExecuteCommandError,
  ExecuteCommandWarning,
} from '../../../desktop/externalApi/executorTypes.js';
import {
  endpointNotInThisBuild,
  resolveItemByNameOrId,
} from '../../../desktop/externalApi/toolUtils.js';
import { DashboardItem, DashboardRefreshOutcome } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
} from '../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { attachNextAction, prefillNextAction, withNextAction } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';
import { nonCleanRefreshSubject } from './refreshOutcomeSubject.js';

const paramsSchema = {
  session: sessionParam(),
  dashboard: z
    .string()
    .describe('Dashboard name or stable id whose pending automatic updates should run now.'),
};
const title = 'Refresh Dashboard Auto Updates';
type RefreshDashboardToolResult = {
  dashboard: { id: string; name: string };
  message: string;
  refreshed?: boolean | DashboardRefreshOutcome['refreshed'];
  outcome?: DashboardRefreshOutcome['outcome'];
  failed?: DashboardRefreshOutcome['failed'];
  warnings?: ExecuteCommandWarning[];
};

export const getRefreshDashboardAutoUpdatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'refresh-dashboard-auto-updates',
    minApiVersion: '0.2.19',
    title,
    description:
      "Run pending automatic updates for every worksheet in one dashboard's current device layout now, without changing the active sheet. Worksheets that refresh stay refreshed when another fails; the call then returns an error whose result reports a PARTIAL or FAILED outcome with per-worksheet results.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, dashboard }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RefreshDashboardToolResult>({
        extra,
        args: { session, dashboard },
        getSuccessResult: commandSuccessResult,
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
            return new DesktopCommandExecutionError(
              result.error,
              result.error.type === 'command-failed' &&
                result.error.error?.code === 'dashboard-refresh-now-failed'
                ? 'Desktop failed before refreshing any worksheet in the dashboard; nothing was refreshed.'
                : undefined,
            ).toErr();
          }

          const dashboardRef = { id: target.id, name: target.name };
          if (result.value.status !== 'completed') {
            const pending = `Requested refreshing auto-updates for dashboard "${target.name}"; Desktop is still applying it`;
            return new Ok(
              commandOk(
                { refreshed: false, dashboard: dashboardRef, message: `${pending}.` },
                result.value,
                pending,
              ),
            );
          }

          const nonClean = nonCleanRefreshSubject(
            `dashboard "${target.name}"`,
            result.value.parsedResult,
          );
          const subject = nonClean ?? `Refreshed auto-updates for dashboard "${target.name}"`;
          const body = {
            dashboard: dashboardRef,
            ...result.value.parsedResult,
            message: `${subject}.`,
          };
          return new Ok(
            commandOk(
              nonClean === undefined
                ? body
                : withNextAction(
                    body,
                    prefillNextAction('Review failed dashboard refresh targets'),
                  ),
              result.value,
              subject,
            ),
          );
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
