import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';
import { resolveItemByNameOrId } from './externalApiToolUtils.js';

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
      title,
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
            toolName: getWorksheetInfo.name,
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
