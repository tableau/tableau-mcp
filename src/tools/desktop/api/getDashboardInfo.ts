import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import {
  artifactNameParam,
  deprecatedArtifactAliasParam,
  resolveArtifactNameArg,
} from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  dashboardName: artifactNameParam('dashboard').optional(),
  dashboard: deprecatedArtifactAliasParam('dashboard'),
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
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, dashboardName, dashboard }, extra): Promise<CallToolResult> => {
      return await getDashboardInfo.logAndExecute({
        extra,
        args: { session, dashboardName, dashboard },
        callback: async () => {
          const nameResult = resolveArtifactNameArg('dashboard', dashboardName, dashboard);
          if (nameResult.isErr()) {
            return nameResult;
          }
          const resolvedDashboardName = nameResult.value;
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
                resolvedDashboardName,
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
