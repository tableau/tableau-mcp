import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheet: z.string().describe('Worksheet name/id.'),
};
const title = 'Get Worksheet Info';

export const getWorksheetInfoTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorksheetInfo = new DesktopTool({
    server,
    name: 'get-worksheet-info',
    title,
    description: 'Read one worksheet by name or id.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheet }, extra): Promise<CallToolResult> => {
      return await getWorksheetInfo.logAndExecute({
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
                'worksheet metadata',
                async (executor, signal) =>
                  await executor.getWorksheet(worksheetResult.value.id, signal),
              );
            },
          });
        },
      });
    },
  });

  return getWorksheetInfo;
};
