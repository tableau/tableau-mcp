import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { listDashboards } from '../../../desktop/commands/workbook/listDashboards.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
};

const title = 'List All Dashboards in Workbook';
export const getListDashboardsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listDashboardsTool = new DesktopTool({
    server,
    name: 'list-dashboards',
    title,
    description: [
      'Gets a list of all dashboard names in the current workbook.',
      'Use this to see what dashboards exist before editing them.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listDashboardsTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const executor = await extra.getExecutor(session);
          const result = await listDashboards({ executor, signal: extra.signal });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return result;
        },
      });
    },
  });

  return listDashboardsTool;
};
