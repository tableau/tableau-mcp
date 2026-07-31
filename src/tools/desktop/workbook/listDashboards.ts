import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { listDashboards } from '../../../desktop/commands/workbook/listDashboards.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

const title = 'List All Dashboards in Workbook';
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
        callback: async () =>
          await runExternalApiReadTool({
            session,
            extra,
            callback: async (executor, signal, read) =>
              await read('dashboard list', async () => await listDashboards({ executor, signal })),
          }),
      });
    },
  });

  return listDashboardsTool;
};
