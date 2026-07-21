import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { listWorksheets } from '../../../desktop/commands/workbook/listWorksheets.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

const title = 'List All Worksheets in Workbook';
export const getListWorksheetsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listWorksheetsTool = new DesktopTool({
    server,
    name: 'list-worksheets',
    title,
    description: 'Gets a list of all worksheet names in the current workbook.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listWorksheetsTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const result = await listWorksheets({ executor, signal: extra.signal });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return result;
        },
      });
    },
  });

  return listWorksheetsTool;
};
