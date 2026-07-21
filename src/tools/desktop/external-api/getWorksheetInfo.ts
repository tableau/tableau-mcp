import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetId: z.string().describe('Worksheet id.'),
};
const title = 'Get Worksheet Info';

export const getWorksheetInfoTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorksheetInfo = new DesktopTool({
    server,
    name: 'get-worksheet-info',
    title,
    description: 'Read one worksheet by id.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, worksheetId }, extra): Promise<CallToolResult> => {
      return await getWorksheetInfo.logAndExecute({
        extra,
        args: { session, worksheetId },
        callback: async () => {
          return await runExternalApiReadTool({
            toolName: getWorksheetInfo.name,
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'worksheet metadata',
                async (executor, signal) => await executor.getWorksheet(worksheetId, signal),
              ),
          });
        },
      });
    },
  });

  return getWorksheetInfo;
};
