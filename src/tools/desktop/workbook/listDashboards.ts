import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { listDashboards } from '../../../desktop/commands/workbook/listDashboards.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
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
      title,
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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
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
