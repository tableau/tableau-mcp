import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { listWorksheets } from '../../../desktop/commands/workbook/listWorksheets.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
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
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listWorksheetsTool.logAndExecute({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiReadTool({
            session,
            extra,
            callback: async (executor, signal, read) =>
              await read('worksheet list', async () => await listWorksheets({ executor, signal })),
          }),
      });
    },
  });

  return listWorksheetsTool;
};
