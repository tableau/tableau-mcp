import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { listWorksheets } from '../../../desktop/wrappers/listWorksheets.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Listing worksheets';
export const getListWorksheetsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listWorksheetsTool = new DesktopTool({
    server,
    name: 'list-worksheets',
    title,
    description: "Lists the workbook's worksheets (stable id and name).",
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
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'worksheet list',
                async (executor, signal) => await listWorksheets({ executor, signal }),
              ),
          });
        },
      });
    },
  });

  return listWorksheetsTool;
};
