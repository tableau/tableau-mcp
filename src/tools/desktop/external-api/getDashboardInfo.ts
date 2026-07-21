import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';
import { resolveItemByNameOrId } from './externalApiToolUtils.js';

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
          const listResult = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const listResult = await read(
                'dashboard list',
                async (executor, signal) => await executor.listDashboards(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const dashboardResult = resolveItemByNameOrId(
                'Dashboard',
                dashboard,
                listResult.value.dashboards ?? [],
              );
              if (dashboardResult.isErr()) {
                return dashboardResult.error.toErr();
              }

              return await read(
                'dashboard metadata',
                async (executor, signal) =>
                  await executor.getDashboard(dashboardResult.value.id, signal),
              );
            },
          });
          return listResult;
        },
      });
    },
  });

  return getDashboardInfo;
};
