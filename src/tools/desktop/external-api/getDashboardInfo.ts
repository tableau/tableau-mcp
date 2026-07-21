import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import {
  endpointNotInThisBuild,
  ExternalApiRequiredError,
  isRouteMissing,
  resolveItemByNameOrId,
} from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  dashboard: z.string().describe('Dashboard name/id.'),
};
const title = 'Get Dashboard Info';

export const getDashboardInfoTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getDashboardInfo = new DesktopTool({
    server,
    name: 'get-dashboard-info',
    title,
    description: 'Read one dashboard by name or id.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, dashboard }, extra): Promise<CallToolResult> => {
      return await getDashboardInfo.logAndExecute({
        extra,
        args: { session, dashboard },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(getDashboardInfo.name).toErr();
          }

          const listResult = await executor.listDashboards(extra.signal);
          if (listResult.isErr()) {
            if (isRouteMissing(listResult.error)) {
              return endpointNotInThisBuild('dashboard list').toErr();
            }
            return new DesktopCommandExecutionError(listResult.error).toErr();
          }

          const dashboardResult = resolveItemByNameOrId(
            'Dashboard',
            dashboard,
            listResult.value.dashboards ?? [],
          );
          if (dashboardResult.isErr()) {
            return dashboardResult.error.toErr();
          }

          const result = await executor.getDashboard(dashboardResult.value.id, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('dashboard metadata').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok(result.value);
        },
      });
    },
  });

  return getDashboardInfo;
};
