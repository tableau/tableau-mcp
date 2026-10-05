import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().describe('Worksheet name/id.'),
};
const title = 'List Worksheet Logical Tables';

export const getListWorksheetLogicalTablesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listWorksheetLogicalTables = new DesktopTool({
    server,
    name: 'list-worksheet-logical-tables',
    title,
    description:
      "List a worksheet's logical tables (id + caption), the input to get-worksheet-underlying-data.",
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheet }, extra): Promise<CallToolResult> => {
      return await listWorksheetLogicalTables.logAndExecute({
        extra,
        args: { session, worksheet },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const listResult = await read(
                'worksheet list',
                async (executor, signal) => await executor.listWorksheets(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const worksheetResult = resolveItemByNameOrId(
                'Worksheet',
                worksheet,
                listResult.value.worksheets ?? [],
              );
              if (worksheetResult.isErr()) {
                return worksheetResult.error.toErr();
              }

              return await read(
                'worksheet logical tables',
                async (executor, signal) =>
                  await executor.listWorksheetLogicalTables(worksheetResult.value.id, signal),
              );
            },
          });
        },
      });
    },
  });

  return listWorksheetLogicalTables;
};
