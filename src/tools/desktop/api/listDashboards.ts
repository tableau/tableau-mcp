import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { listDashboards } from '../../../desktop/wrappers/listDashboards.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Listing dashboards';
export const getListDashboardsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listDashboardsTool = new DesktopTool({
    server,
    name: 'list-dashboards',
    title,
    description: 'Gets a list of all dashboard names in the current workbook.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listDashboardsTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'dashboard list',
                async (executor, signal) => await listDashboards({ executor, signal }),
              ),
          });
        },
      });
    },
  });

  return listDashboardsTool;
};
